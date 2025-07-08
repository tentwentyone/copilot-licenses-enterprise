#!/usr/bin/env node

/**
 * GitHub Copilot License Retrieval Script (Node.js version)
 * 
 * This script retrieves GitHub Copilot billing seat information for an enterprise
 * using the GitHub API.
 * 
 * Usage:
 *   node get_copilot_licenses.js --enterprise ENTERPRISE_NAME --token YOUR_TOKEN
 * 
 * Environment variables:
 *   GITHUB_TOKEN: GitHub personal access token
 *   GITHUB_ENTERPRISE: Enterprise name
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

class CopilotLicenseRetriever {
    /**
     * Class to handle GitHub Copilot license retrieval
     */
    constructor(enterprise, token) {
        this.enterprise = enterprise;
        this.token = token;
        this.baseUrl = 'https://api.github.com';
        this.headers = {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'copilot-license-retriever/1.0'
        };
    }

    /**
     * Make an HTTP GET request
     */
    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, {
                headers: this.headers
            }, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const parsedData = JSON.parse(data);
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            resolve(parsedData);
                        } else {
                            reject(new Error(`HTTP ${response.statusCode}: ${parsedData.message || data}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON response: ${error.message}`));
                    }
                });
            });

            request.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Retrieve Copilot billing seats for the enterprise
     */
    async getCopilotSeats(perPage = 100) {
        const url = `${this.baseUrl}/enterprises/${this.enterprise}/copilot/billing/seats`;
        const allSeats = [];
        let page = 1;

        while (true) {
            const requestUrl = `${url}?per_page=${perPage}&page=${page}`;
            
            try {
                console.error(`Fetching page ${page}...`);
                const data = await this.makeRequest(requestUrl);
                const seats = data.seats || [];

                if (seats.length === 0) {
                    break;
                }

                allSeats.push(...seats.map(seat => this.cleanSeatData(seat)));

                // Check if there are more pages
                if (seats.length < perPage) {
                    break;
                }

                page++;
            } catch (error) {
                console.error(`Error making API request: ${error.message}`);
                process.exit(1);
            }
        }

        return {
            total_seats: allSeats.length,
            seats: allSeats,
            retrieved_at: new Date().toISOString()
        };
    }

    /**
     * Retrieve Copilot billing summary for the enterprise
     */
    async getCopilotBillingSummary() {
        const url = `${this.baseUrl}/enterprises/${this.enterprise}/copilot/billing`;
        
        try {
            return await this.makeRequest(url);
        } catch (error) {
            console.error(`Error retrieving billing summary: ${error.message}`);
            return {};
        }
    }

    /**
     * Clean seat data to include only essential fields
     */
    cleanSeatData(seat) {
        return {
            assignee: {
                login: seat.assignee?.login
            },
            pending_cancellation_date: seat.pending_cancellation_date,
            plan_type: seat.plan_type,
            last_activity_at: seat.last_activity_at,
            last_activity_editor: seat.last_activity_editor,
            created_at: seat.created_at,
            updated_at: seat.updated_at,
            assigning_team: seat.assigning_team ? {
                name: seat.assigning_team.name
            } : null,
            organization: {
                login: seat.organization?.login
            }
        };
    }
}

/**
 * Save data to file in specified format
 */
async function saveToFile(data, filename, formatType = 'json') {
    try {
        if (formatType.toLowerCase() === 'json') {
            await fs.promises.writeFile(filename, JSON.stringify(data, null, 2));
        } else if (formatType.toLowerCase() === 'csv') {
            const seats = data.seats || [];
            if (seats.length === 0) {
                console.error('No seats data to export to CSV');
                return;
            }

            // Flatten the data for CSV output
            const flattenedSeats = seats.map(seat => {
                const flattened = {};

                for (const [key, value] of Object.entries(seat)) {
                    if (key === 'assignee' && value && typeof value === 'object') {
                        // Extract only the login from assignee
                        flattened.User = value.login || '';
                    } else if (key === 'pending_cancellation_date') {
                        flattened['Pending Cancellation Date'] = value || '';
                    } else if (key === 'last_activity_at') {
                        flattened['Last Activity At'] = value || '';
                    } else if (key === 'last_activity_editor') {
                        flattened['Last Activity Editor'] = value || '';
                    } else if (key === 'assigning_team' && value && typeof value === 'object') {
                        // Extract only team name (no description)
                        flattened.Team = value.name || '';
                    } else if (key === 'assigning_team' && value === null) {
                        // Handle null assigning_team
                        flattened.Team = '';
                    } else if (key === 'plan_type') {
                        flattened['Plan Type'] = value || '';
                    } else if (key === 'organization' && value && typeof value === 'object') {
                        // Extract only the login from organization
                        flattened.Organization = value.login || '';
                    } else if (key === 'created_at') {
                        flattened['Created At'] = value || '';
                    } else if (key === 'updated_at') {
                        flattened['Updated At'] = value || '';
                    }
                }

                return flattened;
            });

            // Convert to CSV
            if (flattenedSeats.length > 0) {
                const headers = Object.keys(flattenedSeats[0]);
                const csvContent = [
                    headers.join(','),
                    ...flattenedSeats.map(row => 
                        headers.map(header => {
                            const value = row[header];
                            // Handle CSV escaping
                            if (value === null || value === undefined) {
                                return '';
                            }
                            const stringValue = String(value);
                            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                                return `"${stringValue.replace(/"/g, '""')}"`;
                            }
                            return stringValue;
                        }).join(',')
                    )
                ].join('\n');

                await fs.promises.writeFile(filename, csvContent);
            }
        }
        
        console.log(`Data saved to ${filename}`);
    } catch (error) {
        console.error(`Error saving file: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Print a summary of the Copilot license data
 */
function printSummary(data) {
    const totalSeats = data.total_seats || 0;
    const seats = data.seats || [];
    
    console.log('\n=== GitHub Copilot License Summary ===');
    console.log(`Total seats: ${totalSeats}`);
    console.log(`Retrieved at: ${data.retrieved_at || 'Unknown'}`);
    
    if (seats.length > 0) {
        // Count by assignee type
        const assigneeTypes = {};
        const organizations = new Set();
        
        seats.forEach(seat => {
            const assignee = seat.assignee || {};
            const assigneeType = assignee.type || 'Unknown';
            assigneeTypes[assigneeType] = (assigneeTypes[assigneeType] || 0) + 1;
            
            // Track organizations
            const org = seat.organization?.login;
            if (org) {
                organizations.add(org);
            }
        });
        
        console.log('\nAssignee types:');
        Object.entries(assigneeTypes).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
        console.log(`\nOrganizations: ${organizations.size}`);
        Array.from(organizations).sort().forEach(org => {
            console.log(`  - ${org}`);
        });
        
        // Show recent assignments
        console.log('\nRecent seat assignments (last 5):');
        const sortedSeats = seats
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 5);
            
        sortedSeats.forEach(seat => {
            const assignee = seat.assignee || {};
            const org = seat.organization?.login || 'Unknown';
            const createdAt = seat.created_at || 'Unknown';
            console.log(`  - ${assignee.login || 'Unknown'} (${org}) - ${createdAt}`);
        });
    }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        enterprise: null,
        token: null,
        output: null,
        format: 'json',
        summary: false,
        billing: false,
        perPage: 100
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--enterprise':
            case '-e':
                options.enterprise = args[++i];
                break;
            case '--token':
            case '-t':
                options.token = args[++i];
                break;
            case '--output':
            case '-o':
                options.output = args[++i];
                break;
            case '--format':
            case '-f':
                options.format = args[++i];
                break;
            case '--summary':
            case '-s':
                options.summary = true;
                break;
            case '--billing':
            case '-b':
                options.billing = true;
                break;
            case '--per-page':
                options.perPage = parseInt(args[++i]) || 100;
                break;
            case '--help':
            case '-h':
                console.log(`
GitHub Copilot License Retrieval Script

Usage:
  node get_copilot_licenses.js [options]

Options:
  --enterprise, -e    Enterprise name (or set GITHUB_ENTERPRISE env var)
  --token, -t         GitHub token (or set GITHUB_TOKEN env var)
  --output, -o        Output file path
  --format, -f        Output format (json/csv, default: json)
  --summary, -s       Show summary information
  --billing, -b       Also retrieve billing summary
  --per-page          Results per page (max 100, default: 100)
  --help, -h          Show this help message

Environment variables:
  GITHUB_ENTERPRISE   Enterprise name
  GITHUB_TOKEN        GitHub personal access token

Examples:
  node get_copilot_licenses.js --enterprise my-company --token ghp_xxxx --summary
  node get_copilot_licenses.js --output licenses.csv --format csv
  GITHUB_ENTERPRISE=my-company GITHUB_TOKEN=ghp_xxxx node get_copilot_licenses.js
                `);
                process.exit(0);
                break;
            default:
                console.error(`Unknown option: ${args[i]}`);
                process.exit(1);
        }
    }
    
    return options;
}

/**
 * Main function
 */
async function main() {
    const options = parseArgs();
    
    // Get enterprise and token from args or environment
    const enterprise = options.enterprise || process.env.GITHUB_ENTERPRISE;
    const token = options.token || process.env.GITHUB_TOKEN;
    
    if (!enterprise) {
        console.error('Error: Enterprise name is required. Use --enterprise or set GITHUB_ENTERPRISE env var.');
        process.exit(1);
    }
    
    if (!token) {
        console.error('Error: GitHub token is required. Use --token or set GITHUB_TOKEN env var.');
        process.exit(1);
    }
    
    if (!['json', 'csv'].includes(options.format)) {
        console.error('Error: Format must be "json" or "csv"');
        process.exit(1);
    }
    
    try {
        // Create retriever and get data
        const retriever = new CopilotLicenseRetriever(enterprise, token);
        
        console.error(`Retrieving Copilot licenses for enterprise: ${enterprise}`);
        const seatsData = await retriever.getCopilotSeats(options.perPage);
        
        // Optionally get billing summary
        if (options.billing) {
            console.error('Retrieving billing summary...');
            const billingData = await retriever.getCopilotBillingSummary();
            seatsData.billing_summary = billingData;
        }
        
        // Show summary if requested
        if (options.summary) {
            printSummary(seatsData);
        }
        
        // Save to file if output path provided
        if (options.output) {
            await saveToFile(seatsData, options.output, options.format);
        } else {
            // Print to stdout if no output file specified
            if (options.format === 'json') {
                console.log(JSON.stringify(seatsData, null, 2));
            } else {
                console.error('CSV format requires --output parameter');
                process.exit(1);
            }
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Run the script if called directly
if (require.main === module) {
    main().catch(error => {
        console.error(`Unhandled error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { CopilotLicenseRetriever, saveToFile, printSummary };
