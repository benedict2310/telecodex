export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";

export interface CodexLaunchProfile {
  id: string;
  label: string;
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  unsafe: boolean;
}

export const DEFAULT_LAUNCH_PROFILE_ID = "default";

export function isCodexSandboxMode(value: string): value is CodexSandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

export function isCodexApprovalPolicy(value: string): value is CodexApprovalPolicy {
  return value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted";
}

export function createLaunchProfile(input: {
  id: string;
  label: string;
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
}): CodexLaunchProfile {
  return {
    ...input,
    unsafe: isUnsafeLaunchProfile(input.sandboxMode),
  };
}

export function createDefaultLaunchProfile(
  sandboxMode: CodexSandboxMode,
  approvalPolicy: CodexApprovalPolicy,
): CodexLaunchProfile {
  return createLaunchProfile({
    id: DEFAULT_LAUNCH_PROFILE_ID,
    label: "Default",
    sandboxMode,
    approvalPolicy,
  });
}

export function createBuiltinLaunchProfiles(defaultProfile: CodexLaunchProfile): CodexLaunchProfile[] {
  const profiles = [defaultProfile];
  const seenBehaviors = new Set([getLaunchProfileBehaviorKey(defaultProfile)]);

  const addPreset = (profile: CodexLaunchProfile): void => {
    const key = getLaunchProfileBehaviorKey(profile);
    if (seenBehaviors.has(key)) {
      return;
    }

    profiles.push(profile);
    seenBehaviors.add(key);
  };

  addPreset(
    createLaunchProfile({
      id: "readonly",
      label: "Read Only",
      sandboxMode: "read-only",
      approvalPolicy: "never",
    }),
  );
  addPreset(
    createLaunchProfile({
      id: "workspace-write",
      label: "Workspace Write",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    }),
  );

  return profiles;
}

export function parseLaunchProfilesJson(raw: string): CodexLaunchProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid CODEX_LAUNCH_PROFILES_JSON: expected a JSON array");
  }

  return parsed.map((entry, index) => parseLaunchProfileEntry(entry, index));
}

export function findLaunchProfile(
  profiles: CodexLaunchProfile[],
  profileId: string | undefined,
): CodexLaunchProfile | undefined {
  if (!profileId) {
    return undefined;
  }
  return profiles.find((profile) => profile.id === profileId);
}

export function formatLaunchProfileBehavior(profile: Pick<CodexLaunchProfile, "sandboxMode" | "approvalPolicy">): string {
  return `${profile.sandboxMode} / ${profile.approvalPolicy}`;
}

export function formatLaunchProfileLabel(profile: CodexLaunchProfile, isCurrent = false): string {
  const prefix = profile.unsafe ? "⚠️" : "🛡️";
  const selected = isCurrent ? " ✓" : "";
  return `${prefix} ${profile.label} · ${formatLaunchProfileBehavior(profile)}${selected}`;
}

export function isUnsafeLaunchProfile(
  profileOrSandboxMode: Pick<CodexLaunchProfile, "sandboxMode"> | CodexSandboxMode,
): boolean {
  const sandboxMode =
    typeof profileOrSandboxMode === "string" ? profileOrSandboxMode : profileOrSandboxMode.sandboxMode;
  return sandboxMode === "danger-full-access";
}

function getLaunchProfileBehaviorKey(
  profile: Pick<CodexLaunchProfile, "sandboxMode" | "approvalPolicy">,
): string {
  return `${profile.sandboxMode}:${profile.approvalPolicy}`;
}

function parseLaunchProfileEntry(entry: unknown, index: number): CodexLaunchProfile {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON entry at index ${index}: expected an object`,
    );
  }

  const rawId = readStringField(entry, "id", index);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(rawId)) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON entry at index ${index}: id must match /^[a-z0-9][a-z0-9_-]*$/`,
    );
  }

  const rawLabel = readStringField(entry, "label", index);
  const rawSandboxMode = readStringField(entry, "sandboxMode", index);
  if (!isCodexSandboxMode(rawSandboxMode)) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON entry at index ${index}: unsupported sandboxMode "${rawSandboxMode}"`,
    );
  }

  const rawApprovalPolicy = readStringField(entry, "approvalPolicy", index);
  if (!isCodexApprovalPolicy(rawApprovalPolicy)) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON entry at index ${index}: unsupported approvalPolicy "${rawApprovalPolicy}"`,
    );
  }

  return createLaunchProfile({
    id: rawId,
    label: rawLabel,
    sandboxMode: rawSandboxMode,
    approvalPolicy: rawApprovalPolicy,
  });
}

function readStringField(entry: object, field: string, index: number): string {
  const value = Reflect.get(entry, field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid CODEX_LAUNCH_PROFILES_JSON entry at index ${index}: missing ${field}`,
    );
  }
  return value.trim();
}
