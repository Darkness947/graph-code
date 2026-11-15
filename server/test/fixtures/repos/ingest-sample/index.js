const app = require('./src/app');
import('./src/lazy.js').then((m) => m.default(app));
