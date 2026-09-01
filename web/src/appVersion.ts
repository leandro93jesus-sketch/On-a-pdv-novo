import pkg from '../package.json';

/**
 * Versão exibida na interface. Vem do package.json do web, que é mantido igual
 * ao do projeto e ao da API — assim a tela nunca mostra número desatualizado.
 */
export const APP_VERSION: string = pkg.version;
