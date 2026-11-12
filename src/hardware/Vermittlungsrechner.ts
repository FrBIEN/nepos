import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// Vermittlungsrechner - Router with routing table, firewall, and IP forwarding

import { Knoten, KnotenConfig } from './Knoten';
import { NetzwerkInterface, NetzwerkInterfaceConfig } from './NetzwerkInterface';
import { i18n } from '../i18n';
import { ipToNumber, getNetworkAddress, normalizeIP, isValidSubnetMask, isValidIPPattern, isValidPortPattern } from '../network/utils';

export interface RouteEntry {
    network: string;
    subnetMask: string;
    gateway: string;
    interfaceIndex: number;
    metric: number;
    isStatic?: boolean;
}

export interface FirewallRule {
    id: string;
    enabled: boolean;
    action: 'allow' | 'deny';
    direction: 'inbound' | 'outbound' | 'both';
    protocol: 'any' | 'icmp' | 'tcp' | 'udp';
    sourceIP: string;    // IP or 'any' or CIDR notation
    destIP: string;      // IP or 'any' or CIDR notation
    sourcePort?: string; // Port or range e.g. '80' or '1-1024'
    destPort?: string;
    description?: string;
}

export interface PortForward { protocol: 'tcp' | 'udp'; externalPort: number; internalIP: string; internalPort: number }

export interface VermittlungsrechnerConfig extends KnotenConfig {
    type: 'router';
    interfaces?: NetzwerkInterfaceConfig[];
    natEnabled?: boolean;
    wanInterface?: number;
    portForwards?: PortForward[];
    ripEnabled?: boolean;
    routes?: RouteEntry[];
    firewallRules?: FirewallRule[];
    firewallEnabled?: boolean;
    ipForwardingEnabled?: boolean;
}

export class Vermittlungsrechner extends Knoten {
    private natEnabled = false;
    private wanInterface = 1;
    private portForwards: PortForward[] = [];
    private ripEnabled = false;
    private dynamicRoutes = new Map<string, { route: RouteEntry; expires: number }>();
    private interfaces: NetzwerkInterface[];
    private routingTable: RouteEntry[] = [];
    private firewallRules: FirewallRule[] = [];
    private firewallEnabled: boolean = false;
    private ipForwardingEnabled: boolean;

    static readonly MAX_INTERFACES = 8;
    static readonly MIN_INTERFACES = 2;

    constructor(config: VermittlungsrechnerConfig, runtime: RuntimeDependencies = legacyRuntime) {
        super(config, runtime);

        // Default: 2 interfaces for a router
        const interfaceConfigs = config.interfaces || [
            { ip: '192.168.1.1', subnetMask: '255.255.255.0' },
            { ip: '192.168.2.1', subnetMask: '255.255.255.0' },
        ];

        this.natEnabled = config.natEnabled ?? false;
        this.wanInterface = config.wanInterface ?? interfaceConfigs.length - 1;
        this.portForwards = config.portForwards ?? [];
        this.ripEnabled = config.ripEnabled ?? false;
        this.interfaces = interfaceConfigs.map(cfg => new NetzwerkInterface(cfg, this.runtime));
        this.ipForwardingEnabled = config.ipForwardingEnabled ?? true;
        this.firewallEnabled = config.firewallEnabled ?? false;

        if (config.routes) {
            this.routingTable = [...config.routes];
        } else {
            this.updateDirectRoutes();
        }

        if (config.firewallRules) {
            config.firewallRules.forEach(rule => this.validateFirewallRule(rule));
            this.firewallRules = config.firewallRules.map(rule => ({ ...rule }));
        } else {
            // Default firewall rules - allow all
            this.firewallRules = [
                {
                    id: 'default-deny',
                    enabled: true,
                    action: 'deny',
                    direction: 'both',
                    protocol: 'any',
                    sourceIP: 'any',
                    destIP: 'any',
                    description: 'Standardregel: Alles verweigern',
                },
            ];
        }
    }

    protected getDefaultName(): string {
        const counter = this.runtime.ids.nextName('router');
        return `${i18n.t('devices.router')} ${counter}`;
    }

    static resetNameCounter(): void {
        legacyRuntime.ids.resetNames('router');
    }

    getPortCount(): number {
        return this.interfaces.length;
    }

    getIconPath(): string {
        return 'icons/router.svg';
    }

    isNATEnabled(): boolean { return this.natEnabled; }
    setNATEnabled(value: boolean): void { this.natEnabled = value; }
    getWANInterface(): number { return this.wanInterface; }
    setWANInterface(index: number): void { if (this.interfaces[index]) this.wanInterface = index; }
    getPortForwards(): PortForward[] { return this.portForwards.map(f => ({ ...f })); }
    addPortForward(rule: PortForward): void {
        if (!normalizeIP(rule.internalIP) || !Number.isInteger(rule.externalPort) || !Number.isInteger(rule.internalPort) || rule.externalPort < 1 || rule.externalPort > 65535 || rule.internalPort < 1 || rule.internalPort > 65535) throw new Error('Ungültige Portweiterleitung');
        if (this.portForwards.some(f => f.protocol === rule.protocol && f.externalPort === rule.externalPort)) throw new Error('Portweiterleitung existiert bereits');
        this.portForwards.push({ ...rule });
    }
    removePortForward(index: number): void { this.portForwards.splice(index, 1); }
    isRIPEnabled(): boolean { return this.ripEnabled; }
    setRIPEnabled(value: boolean): void { this.ripEnabled = value; if (!value) this.dynamicRoutes.clear(); }
    clearDynamicRoutes(): void { this.dynamicRoutes.clear(); }
    learnRIP(network: string, subnetMask: string, gateway: string, interfaceIndex: number, metric: number, now: number): void {
        if (!normalizeIP(network) || !isValidSubnetMask(subnetMask) || !Number.isInteger(metric) || metric < 1 || metric > 16) return;
        const key = `${network}/${subnetMask}`, known = this.dynamicRoutes.get(key);
        if (metric >= 16) { if (known?.route.gateway === gateway) this.dynamicRoutes.delete(key); return; }
        if (!known || known.route.gateway === gateway || known.route.metric > metric) this.dynamicRoutes.set(key, { route: { network, subnetMask, gateway, interfaceIndex, metric, isStatic: false }, expires: now + 180000 });
    }
    expireRIP(now: number): void { for (const [key, value] of this.dynamicRoutes) if (value.expires <= now) this.dynamicRoutes.delete(key); }

    // ============= INTERFACE MANAGEMENT ===================
    getInterface(index: number): NetzwerkInterface | null {
        return this.interfaces[index] || null;
    }

    getInterfaces(): NetzwerkInterface[] {
        return [...this.interfaces];
    }

    canAddInterface(): boolean {
        return this.interfaces.length < Vermittlungsrechner.MAX_INTERFACES;
    }

    canRemoveInterface(): boolean {
        return this.interfaces.length > Vermittlungsrechner.MIN_INTERFACES;
    }

    addInterface(): number {
        if (!this.canAddInterface()) {
            return -1;
        }
        const newInterface = new NetzwerkInterface({
            ip: `192.168.${this.interfaces.length + 1}.1`,
            subnetMask: '255.255.255.0',
        }, this.runtime);
        this.interfaces.push(newInterface);
        this.updateDirectRoutes();
        return this.interfaces.length - 1;
    }

    removeInterface(index: number): boolean {
        if (!this.canRemoveInterface() || index < 0 || index >= this.interfaces.length) {
            return false;
        }
        if (this.interfaces[index].isConnected()) return false;
        this.interfaces.splice(index, 1);
        if (this.wanInterface === index) this.wanInterface = this.interfaces.length - 1; else if (this.wanInterface > index) this.wanInterface--;
        this.dynamicRoutes.clear();
        // Update routing table interface indices
        this.routingTable = this.routingTable.filter(r => r.interfaceIndex !== index);
        this.routingTable.forEach(r => {
            if (r.interfaceIndex > index) r.interfaceIndex--;
        });
        this.updateDirectRoutes();
        return true;
    }

    // Get interface port positions for visual connection points
    // Position is center, so bounds are: left = x - 30, right = x + 30
    getInterfacePositions(): { index: number; x: number; y: number; side: 'left' | 'right' }[] {
        const positions: { index: number; x: number; y: number; side: 'left' | 'right' }[] = [];
        const count = this.interfaces.length;
        const bounds = this.getBounds(); // x, y, width, height (60x60)

        // Distribute ports: first half on left, rest on right
        const leftCount = Math.ceil(count / 2);
        const rightCount = count - leftCount;

        // Icon center Y
        const centerY = bounds.y + bounds.height / 2;

        // Left side ports (0 to leftCount-1)
        for (let i = 0; i < leftCount; i++) {
            const spacing = leftCount > 1 ? (bounds.height - 20) / (leftCount - 1) : 0;
            const y = leftCount > 1
                ? bounds.y + 10 + i * spacing
                : centerY;
            positions.push({
                index: i,
                x: bounds.x - 10,
                y,
                side: 'left'
            });
        }

        // Right side ports (leftCount to count-1)
        for (let i = 0; i < rightCount; i++) {
            const spacing = rightCount > 1 ? (bounds.height - 20) / (rightCount - 1) : 0;
            const y = rightCount > 1
                ? bounds.y + 10 + i * spacing
                : centerY;
            positions.push({
                index: leftCount + i,
                x: bounds.x + bounds.width + 10,
                y,
                side: 'right'
            });
        }

        return positions;
    }

    // ============= IP FORWARDING ===================
    isIPForwardingEnabled(): boolean {
        return this.ipForwardingEnabled;
    }

    setIPForwardingEnabled(enabled: boolean): void {
        this.ipForwardingEnabled = enabled;
    }

    // ============= ROUTING TABLE ===================
    private updateDirectRoutes(): void {
        // Remove old direct routes (gateway = 0.0.0.0)
        this.routingTable = this.routingTable.filter(r => r.isStatic);

        // Add new direct routes for each interface
        this.interfaces.forEach((iface, index) => {
            const network = getNetworkAddress(iface.getIP(), iface.getSubnetMask());
            this.routingTable.push({
                network,
                subnetMask: iface.getSubnetMask(),
                gateway: '0.0.0.0', // Direct connection
                interfaceIndex: index,
                metric: 0,
                isStatic: false,
            });
        });
    }

    addStaticRoute(network: string, subnetMask: string, gateway: string, interfaceIndex: number, metric: number = 1): void {
        if (!normalizeIP(network) || !isValidSubnetMask(subnetMask) || !normalizeIP(gateway) || !this.interfaces[interfaceIndex] || !Number.isFinite(metric) || metric < 0) throw new Error('Ungültige Route');
        this.routingTable.push({
            network: getNetworkAddress(network, subnetMask),
            subnetMask,
            gateway,
            interfaceIndex,
            metric,
            isStatic: true,
        });
    }

    addRoute(route: RouteEntry): void {
        this.routingTable.push({ ...route });
    }

    removeRoute(index: number): boolean {
        if (index < 0 || index >= this.routingTable.length) {
            return false;
        }
        const route = this.routingTable[index];
        // Don't allow removing direct routes
        if (route.gateway === '0.0.0.0') {
            return false;
        }
        this.routingTable.splice(index, 1);
        return true;
    }

    getRoutingTable(): RouteEntry[] {
        this.updateDirectRoutes();
        return [...this.routingTable, ...Array.from(this.dynamicRoutes.values(), v => v.route)];
    }

    getStaticRoutes(): RouteEntry[] {
        return this.routingTable.filter(r => r.isStatic);
    }

    clearStaticRoutes(): void {
        this.routingTable = this.routingTable.filter(r => !r.isStatic);
    }

    // Route lookup - finds best matching route for destination IP
    findRoute(destinationIP: string): RouteEntry | null {
        this.updateDirectRoutes();
        const destNum = ipToNumber(destinationIP);
        let bestMatch: RouteEntry | null = null;
        let longestPrefix = -1;

        for (const route of this.getRoutingTable()) {
            const networkNum = ipToNumber(route.network);
            const maskNum = ipToNumber(route.subnetMask);

            if ((destNum & maskNum) === (networkNum & maskNum)) {
                const prefixLength = maskNum.toString(2).split('1').length - 1;

                if (prefixLength > longestPrefix) {
                    longestPrefix = prefixLength;
                    bestMatch = route;
                } else if (prefixLength === longestPrefix && bestMatch && route.metric < bestMatch.metric) {
                    bestMatch = route;
                }
            }
        }

        return bestMatch;
    }

    // ============= FIREWALL ===================
    isFirewallEnabled(): boolean {
        return this.firewallEnabled;
    }

    setFirewallEnabled(enabled: boolean): void {
        this.firewallEnabled = enabled;
    }

    getFirewallRules(): FirewallRule[] {
        return [...this.firewallRules];
    }

    private validateFirewallRule(rule: Omit<FirewallRule, 'id'>): void {
        if (typeof rule.enabled !== 'boolean' || !['allow','deny'].includes(rule.action) || !['inbound','outbound','both'].includes(rule.direction) || !['any','icmp','tcp','udp'].includes(rule.protocol) || !isValidIPPattern(rule.sourceIP) || !isValidIPPattern(rule.destIP) || !isValidPortPattern(rule.sourcePort) || !isValidPortPattern(rule.destPort)) throw new Error('Ungültige Firewall-Regel: IP/CIDR und Portbereich prüfen');
    }

    addFirewallRule(rule: Omit<FirewallRule, 'id'>): string {
        this.validateFirewallRule(rule);
        const id = `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.firewallRules.push({ ...rule, id });
        return id;
    }

    removeFirewallRule(id: string): boolean {
        const index = this.firewallRules.findIndex(r => r.id === id);
        if (index === -1) return false;
        this.firewallRules.splice(index, 1);
        return true;
    }

    updateFirewallRule(id: string, updates: Partial<FirewallRule>): boolean {
        const rule = this.firewallRules.find(r => r.id === id);
        if (!rule) return false;
        this.validateFirewallRule({ ...rule, ...updates });
        Object.assign(rule, updates);
        return true;
    }

    moveFirewallRule(id: string, direction: 'up' | 'down'): boolean {
        const index = this.firewallRules.findIndex(r => r.id === id);
        if (index === -1) return false;

        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= this.firewallRules.length) return false;

        const [rule] = this.firewallRules.splice(index, 1);
        this.firewallRules.splice(newIndex, 0, rule);
        return true;
    }

    // Check if packet is allowed by firewall
    checkFirewall(
        sourceIP: string,
        destIP: string,
        protocol: string,
        sourcePort?: number,
        destPort?: number,
        direction: 'inbound' | 'outbound' = 'inbound'
    ): boolean {
        if (!this.firewallEnabled) return true;

        for (const rule of this.firewallRules) {
            if (!rule.enabled) continue;
            if (rule.direction !== 'both' && rule.direction !== direction) continue;

            // Check protocol
            if (rule.protocol !== 'any' && rule.protocol !== protocol.toLowerCase()) continue;

            // Check source IP
            if (rule.sourceIP !== 'any' && !this.matchIP(sourceIP, rule.sourceIP)) continue;

            // Check dest IP
            if (rule.destIP !== 'any' && !this.matchIP(destIP, rule.destIP)) continue;

            // Check ports if specified
            if (rule.sourcePort && (sourcePort === undefined || !this.matchPort(sourcePort, rule.sourcePort))) continue;
            if (rule.destPort && (destPort === undefined || !this.matchPort(destPort, rule.destPort))) continue;

            // Rule matches
            return rule.action === 'allow';
        }

        // Default: deny if no rule matches
        return false;
    }

    private matchIP(ip: string, pattern: string): boolean {
        if (pattern === 'any') return true;
        if (pattern.includes('/')) {
            // CIDR notation
            const [network, prefixStr] = pattern.split('/');
            const prefix = parseInt(prefixStr, 10);
            if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
            const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
            return (ipToNumber(ip) & mask) === (ipToNumber(network) & mask);
        }
        return ip === pattern;
    }

    private matchPort(port: number, pattern: string): boolean {
        if (pattern.includes('-')) {
            const [start, end] = pattern.split('-').map(Number);
            return port >= start && port <= end;
        }
        return port === parseInt(pattern, 10);
    }

    // ============= UTILITY ===================
    isLocalIP(ip: string): boolean {
        return this.interfaces.some(iface => iface.getIP() === ip);
    }

    getInterfaceForIP(ip: string): { interface: NetzwerkInterface; index: number } | null {
        for (let i = 0; i < this.interfaces.length; i++) {
            const iface = this.interfaces[i];
            const network1 = getNetworkAddress(ip, iface.getSubnetMask());
            const network2 = getNetworkAddress(iface.getIP(), iface.getSubnetMask());
            if (network1 === network2) {
                return { interface: iface, index: i };
            }
        }
        return null;
    }

    // ============= SERIALIZATION ===================
    toJSON(): VermittlungsrechnerConfig {
        return {
            id: this.id,
            name: this.name,
            type: 'router',
            natEnabled: this.natEnabled, wanInterface: this.wanInterface, portForwards: this.portForwards, ripEnabled: this.ripEnabled,
            position: this.position,
            interfaces: this.interfaces.map(i => i.toJSON()),
            routes: this.routingTable,
            firewallRules: this.firewallRules,
            firewallEnabled: this.firewallEnabled,
            ipForwardingEnabled: this.ipForwardingEnabled,
        };
    }

    static fromJSON(config: VermittlungsrechnerConfig, runtime: RuntimeDependencies = legacyRuntime): Vermittlungsrechner {
        return new Vermittlungsrechner(config, runtime);
    }
}

export function createRouter(config: Partial<VermittlungsrechnerConfig> = {}, runtime: RuntimeDependencies = legacyRuntime): Vermittlungsrechner {
    return new Vermittlungsrechner({ ...config, type: 'router' }, runtime);
}
