import * as https from 'https';
import * as url from 'url';
import * as http from 'http'; // Imported for underlying stream definitions

export class TahciaClient {
    private apiUrl = "https://api.tahcia.com";
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    private request(method: 'GET' | 'PUT' | 'DELETE', endpoint: string, payload?: any): Promise<any> {
        const targetUrl = `${this.apiUrl}${endpoint}`;
        const parsedUrl = url.parse(targetUrl);
        
        const options: https.RequestOptions = {
            method: method,
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            port: parsedUrl.port || 443,
            headers: this.getHeaders()
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(data ? JSON.parse(data) : {});
                        } else {
                            reject(new Error(`Server responded with status code ${res.statusCode}: ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', (err: Error) => reject(err));

            if (payload) {
                req.write(JSON.stringify(payload));
            }
            req.end();
        });
    }

    public async listScripts(): Promise<string[]> {
        try {
            return await this.request('GET', '/ide/scripts/@me/list');
        } catch (e: any) {
            throw new Error(`Failed to list remote scripts: ${e.message}`);
        }
    }

    public async downloadScript(name: string): Promise<string> {
        try {
            const encodedName = encodeURIComponent(name);
            const res = await this.request('GET', `/ide/scripts/@me/${encodedName}`);
            return res.content !== undefined ? res.content : '';
        } catch (e: any) {
            throw new Error(`Failed to download script '${name}': ${e.message}`);
        }
    }

    public async uploadScript(name: string, code: string): Promise<any> {
        try {
            const encodedName = encodeURIComponent(name);
            return await this.request('PUT', `/ide/scripts/@me/${encodedName}`, { code });
        } catch (e: any) {
            throw new Error(`Failed to upload script '${name}': ${e.message}`);
        }
    }

    public async deleteScript(name: string): Promise<any> {
        try {
            const encodedName = encodeURIComponent(name);
            return await this.request('DELETE', `/ide/scripts/@me/${encodedName}`);
        } catch (e: any) {
            throw new Error(`Failed to delete script '${name}': ${e.message}`);
        }
    }
}