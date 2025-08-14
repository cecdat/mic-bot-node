"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const http_proxy_agent_1 = require("http-proxy-agent");
const https_proxy_agent_1 = require("https-proxy-agent");
const socks_proxy_agent_1 = require("socks-proxy-agent");
class AxiosClient {
    constructor(account) {
        this.account = account;
        this.instance = axios_1.default.create();
        // If a proxy configuration is provided, set up the agent
        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account);
            this.instance.defaults.httpAgent = agent;
            this.instance.defaults.httpsAgent = agent;
        }
    }
    getAgentForProxy(proxyConfig) {
        const { url, port } = proxyConfig;
        switch (true) {
            case proxyConfig.url.startsWith('http'):
                return new http_proxy_agent_1.HttpProxyAgent(`${url}:${port}`);
            case proxyConfig.url.startsWith('https'):
                return new https_proxy_agent_1.HttpsProxyAgent(`${url}:${port}`);
            case proxyConfig.url.startsWith('socks'):
                return new socks_proxy_agent_1.SocksProxyAgent(`${url}:${port}`);
            default:
                throw new Error(`Unsupported proxy protocol: ${url}`);
        }
    }
    // Generic method to make any Axios request
    async request(config, bypassProxy = false) {
        if (bypassProxy) {
            const bypassInstance = axios_1.default.create();
            return bypassInstance.request(config);
        }
        return this.instance.request(config);
    }
}
exports.default = AxiosClient;
//# sourceMappingURL=Axios.js.map