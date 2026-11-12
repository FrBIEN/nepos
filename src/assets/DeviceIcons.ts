import modemIcon from './icons/modem.svg';
import routerIcon from './icons/router.svg';
import switchIcon from './icons/switch.svg';
import laptopIcon from './icons/laptop.svg';
import serverIcon from './icons/server.svg';
import accesspointIcon from './icons/accesspoint.svg';
export const Icons = {
    router: routerIcon,
    switch: switchIcon,
    notebook: laptopIcon,
    rechner: serverIcon,
    server: serverIcon,
    modem: modemIcon,
    accesspoint: accesspointIcon,
};
export type IconName = keyof typeof Icons;
