import type { Ctx, ExecResult, Permission } from '@desk-agent/plugin-sdk';

export interface PermissionDenial {
  pluginId: string;
  capability: string;
  requiredPermission: Permission;
}

export function createEnforcedCtx(
  pluginId: string,
  grantedPermissions: Permission[],
  base: Ctx,
  onDenied: (denial: PermissionDenial) => void,
): Ctx {
  const granted = new Set(grantedPermissions);

  return {
    http: {
      async fetch(url, init) {
        if (!granted.has('net:api.weather')) {
          onDenied({ pluginId, capability: 'http.fetch', requiredPermission: 'net:api.weather' });
          return new Response(null, { status: 403, statusText: 'permission denied' });
        }
        return base.http.fetch(url, init);
      },
    },
    timer: base.timer,
    log: base.log,
    publishEvent: base.publishEvent,
    publishWidget: base.publishWidget,
    exec: {
      async run(command, args): Promise<ExecResult> {
        const hasSysPermission = granted.has('sys:read-stats') || granted.has('sys:control-display');
        if (!hasSysPermission) {
          onDenied({ pluginId, capability: 'exec.run', requiredPermission: 'sys:read-stats' });
          return { stdout: '', stderr: 'permission denied: sys:read-stats or sys:control-display required', code: 1 };
        }
        return base.exec.run(command, args);
      },
    },
  };
}
