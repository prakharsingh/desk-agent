import type { DeskAgentApi } from './index.js';

declare global {
  interface Window {
    deskAgent: DeskAgentApi;
  }
}
