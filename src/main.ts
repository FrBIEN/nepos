import './styles/main.css';
import './styles/responsive.css';
import { NeposApplication } from './application/NeposApplication';
import { createApplicationContext } from './application/ApplicationContext';
function start(): void {
    const application = new NeposApplication(createApplicationContext());
    import.meta.hot?.dispose(() => application.dispose());
}
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
else
    start();
