import type { Ctx, ExecResult, Permission } from '@desk-agent/plugin-sdk';

export interface PermissionDenial {
  pluginId: string;
  capability: string;
  /** null when no permission allows the attempted invocation at all */
  requiredPermission: Permission | null;
}

// Exec is allowlisted per permission, not gated on "holds some sys:*
// permission": sys:read-stats must not unlock display control (or vice
// versa), and no permission unlocks arbitrary commands. `firstArg` pins the
// pmset subcommand, splitting its read mode from its control mode.
const EXEC_ALLOWLIST: ReadonlyArray<{ permission: Permission; command: string; firstArg?: string }> = [
  { permission: 'sys:read-stats', command: 'pmset', firstArg: '-g' },
  { permission: 'sys:read-stats', command: 'nowplaying-cli', firstArg: 'get' },
  { permission: 'sys:read-stats', command: 'pgrep', firstArg: '-i' },
  { permission: 'sys:control-display', command: 'pmset', firstArg: 'displaysleepnow' },
  { permission: 'sys:control-display', command: 'caffeinate' },
  { permission: 'sys:control-media', command: 'nowplaying-cli', firstArg: 'play' },
  { permission: 'sys:control-media', command: 'nowplaying-cli', firstArg: 'pause' },
  { permission: 'sys:control-media', command: 'nowplaying-cli', firstArg: 'togglePlayPause' },
  { permission: 'sys:control-media', command: 'nowplaying-cli', firstArg: 'next' },
  { permission: 'sys:control-media', command: 'nowplaying-cli', firstArg: 'previous' },
];

function execPermissionsFor(command: string, args: string[] | undefined): Permission[] {
  return EXEC_ALLOWLIST
    .filter((rule) => rule.command === command && (rule.firstArg === undefined || args?.[0] === rule.firstArg))
    .map((rule) => rule.permission);
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
        const allowedBy = execPermissionsFor(command, args);
        if (!allowedBy.some((permission) => granted.has(permission))) {
          const requiredPermission = allowedBy[0] ?? null;
          onDenied({ pluginId, capability: `exec.run(${command})`, requiredPermission });
          const stderr = requiredPermission
            ? `permission denied: ${command} requires ${requiredPermission}`
            : `permission denied: ${command} is not allowed under any sys:* permission`;
          return { stdout: '', stderr, code: 1 };
        }
        return base.exec.run(command, args);
      },
    },
  };
}
