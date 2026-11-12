/** Port numbers shared by the applications using the simulated UDP sockets. */
export class UDP {
    static readonly Ports = {
        DNS: 53,
        DHCP_SERVER: 67,
        DHCP_CLIENT: 68,
    } as const;
}
