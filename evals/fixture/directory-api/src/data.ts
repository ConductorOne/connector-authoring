/**
 * Deterministic seed for the Directory API eval fixture.
 *
 * Every row is a pure function of its index — no RNG, no clock — so counts,
 * IDs, and trap rows are identical across restarts and deployments. The eval
 * harness queries `/_fixture/expectations` (derived from this module) instead
 * of hardcoding counts, per the probe-contracts rule "count parity, not
 * fixture counts".
 */

export type Domain = "corp" | "partners";

export interface FixtureUser {
  id: string;
  name: string;
  /** Trap: null on a few rows — forces a projection/display-name decision. */
  email: string | null;
  active: boolean;
  title: string | null;
  managerId: string | null;
  domain: Domain;
}

export interface FixtureGroup {
  id: string;
  name: string;
  description: string;
}

export type MemberState = "active" | "pending";

export interface FixtureMembership {
  groupId: string;
  userId: string;
  /**
   * Trap: "pending" rows are listed by the API but must NOT produce grants
   * (mirrors the probe-contracts must-not-exist membership rule).
   */
  state: MemberState;
}

export interface FixtureRole {
  id: string;
  name: string;
  description: string;
}

/** Eval-only basic-auth username (the "account-email" config field). */
export const FIXTURE_ACCOUNT_EMAIL = "connector@fixture.example";
/** Eval-only credential (the "api-token" config field; also the v2 bearer token). */
export const FIXTURE_API_TOKEN = "fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4";

const FIRST = [
  "Ada", "Bjorn", "Cleo", "Dara", "Emil", "Farah", "Gus", "Hana",
  "Ivan", "Juno", "Kofi", "Lena", "Milo", "Nadia", "Otto", "Priya",
  "Quinn", "Rosa", "Sam", "Tara", "Umar", "Vera", "Wade", "Xena",
  "Yusuf", "Zoe",
];
const LAST = [
  "Alvarez", "Byrd", "Chen", "Dube", "Ellison", "Fontaine", "Gupta", "Hale",
  "Iversen", "Jacobs", "Kovacs", "Lindqvist", "Mbeki", "Novak", "Osei", "Petrov",
  "Quist", "Rivas", "Sato", "Tipling", "Ueda", "Vance", "Weber", "Xu",
  "Yamada", "Zhang",
];
const TITLES = [
  "Engineer", "Designer", "Manager", "Analyst", "Director", "Support Lead", null,
];

export const USER_COUNT = 230;
export const PARTNER_USER_COUNT = 12;
export const GROUP_COUNT = 12;
export const ROLE_COUNT = 8;

const userId = (n: number): string => `u${String(n).padStart(4, "0")}`;
const groupId = (n: number): string => `g${String(n).padStart(2, "0")}`;
const roleId = (n: number): string => `r${String(n).padStart(2, "0")}`;

function buildUsers(): FixtureUser[] {
  const users: FixtureUser[] = [];
  for (let n = 1; n <= USER_COUNT; n++) {
    const id = userId(n);
    const first = FIRST[(n * 7) % FIRST.length];
    const last = LAST[(n * 11) % LAST.length];
    const domain: Domain = n > USER_COUNT - PARTNER_USER_COUNT ? "partners" : "corp";
    users.push({
      id,
      name: `${first} ${last}`,
      // Trap rows: u0007 and u0113 have no email — a connector must decide how
      // to project login/display name instead of blindly reading user.email.
      email: n === 7 || n === 113 ? null : `${first}.${last}.${n}@fixture.example`.toLowerCase(),
      // One disabled row proves status mapping (include_disabled-style flag).
      active: n !== 42,
      title: TITLES[n % TITLES.length],
      // u0013 is the top of the tree: managerId null.
      managerId: n === 13 ? null : userId(13),
      domain,
    });
  }
  return users;
}

function buildGroups(): FixtureGroup[] {
  const names = [
    "Engineering", "Design", "Support", "Sales",
    "Marketing", "People", "Finance", "Legal",
    "Security", "Data", "Product", "Partners",
  ];
  return names.map((name, i) => ({
    id: groupId(i + 1),
    name,
    description: `The ${name} group`,
  }));
}

function buildMemberships(): FixtureMembership[] {
  const rows: FixtureMembership[] = [];
  for (let g = 1; g <= GROUP_COUNT; g++) {
    const gid = groupId(g);
    // ~28 active members per group, spread deterministically across all users.
    for (let k = 0; k < 28; k++) {
      const n = ((g * 37 + k * 13) % USER_COUNT) + 1;
      rows.push({ groupId: gid, userId: userId(n), state: "active" });
    }
  }
  // Pending rows: listed by the API, must NOT produce grants. Includes a
  // partner-domain user so a domain-scoped sync and the pending trap interact.
  const pending: Array<[number, number]> = [
    [1, 5], [2, 55], [3, 101], [5, 7], [8, 113], [12, 225],
  ];
  for (const [g, n] of pending) {
    rows.push({ groupId: groupId(g), userId: userId(n), state: "pending" });
  }
  // De-duplicate identical (groupId, userId) pairs, keeping the first state.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.groupId}:${r.userId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildRoles(): FixtureRole[] {
  const names = [
    "Org Admin", "Helpdesk", "Billing Viewer", "Read Only",
    "Deployer", "Auditor", "On Call", "Contractor",
  ];
  return names.map((name, i) => ({
    id: roleId(i + 1),
    name,
    description: `${name} role`,
  }));
}

export const users: readonly FixtureUser[] = buildUsers();
export const groups: readonly FixtureGroup[] = buildGroups();
export const memberships: readonly FixtureMembership[] = buildMemberships();
export const roles: readonly FixtureRole[] = buildRoles();

/** Harness-facing expected counts, derived from the seed (never hardcoded). */
export function expectations() {
  const activeMemberships = memberships.filter((m) => m.state === "active");
  const pendingMemberships = memberships.filter((m) => m.state === "pending");
  return {
    users: {
      total: users.length,
      byDomain: {
        corp: users.filter((u) => u.domain === "corp").length,
        partners: users.filter((u) => u.domain === "partners").length,
      },
      inactive: users.filter((u) => !u.active).length,
      nullEmail: users.filter((u) => u.email === null).map((u) => u.id),
    },
    groups: groups.length,
    memberships: {
      active: activeMemberships.length,
      pending: pendingMemberships.length,
      pendingRows: pendingMemberships.map((m) => `${m.groupId}:${m.userId}`),
    },
    roles: roles.length,
  };
}
