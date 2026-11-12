// Hardware module index - exports all hardware components

export { Knoten, type KnotenType, type KnotenConfig } from './Knoten';
export { Host, createRechner, createNotebook, type HostConfig } from './Host';
export { Switch, createSwitch, type SwitchConfig } from './Switch';
export { Vermittlungsrechner, createRouter, type VermittlungsrechnerConfig, type RouteEntry } from './Vermittlungsrechner';
export { NetzwerkInterface, type NetzwerkInterfaceConfig } from './NetzwerkInterface';
export { Kabel, createKabel, type KabelConfig, type KabelEndpoint } from './Kabel';
export { Modem, createModem, type ModemConfig } from './Modem';
