// Deterministic Directory API fixture seed.
// No randomness, no Date.now, no env reads — the seed is pinned in
// evals/scenarios/tier1-directory.json and asserted by verify.sh.

export type DirectoryUser = {
  id: string
  name: string
  email: string
  active: boolean
  title: string | null
}

export type DirectoryGroup = {
  id: string
  name: string
}

export type Membership = {
  groupId: string
  userId: string
}

export const FIXTURE_BASIC_USERNAME = "connector@example.com"
export const FIXTURE_BASIC_PASSWORD = "fixture-token"
export const FIXTURE_BEARER_TOKEN = "fixture-token"

export const NULL_TITLE_USER_IDS: string[] = ["user-003", "user-011", "user-019"]

const pad = (n: number): string => String(n).padStart(3, "0")

export const USERS: DirectoryUser[] = Array.from({length: 23}, (_, i) => {
  const n = i + 1
  const id = `user-${pad(n)}`
  const title = NULL_TITLE_USER_IDS.includes(id)
    ? null
    : n % 2 === 0
      ? "Engineer"
      : "Manager"
  return {
    id,
    name: `User ${pad(n)}`,
    email: `${id}@example.com`,
    active: n !== 7 && n !== 13,
    title,
  }
})

export const GROUPS: DirectoryGroup[] = Array.from({length: 5}, (_, i) => {
  const n = i + 1
  return {id: `group-${pad(n)}`, name: `Group ${pad(n)}`}
})

// group-001: user-001..user-005; group-002: user-006..user-010;
// group-003: user-011..user-015; group-004: user-016..user-020;
// group-005: user-021..user-023. 23 memberships total.
export const MEMBERSHIPS: Membership[] = (() => {
  const out: Membership[] = []
  for (let g = 1; g <= 5; g++) {
    const start = (g - 1) * 5 + 1
    const end = g === 5 ? 23 : g * 5
    for (let u = start; u <= end; u++) {
      out.push({groupId: `group-${pad(g)}`, userId: `user-${pad(u)}`})
    }
  }
  return out
})()

// Trap (a): GET /v1/users without the required account_id scoping param
// returns only this 3-row subset (under-sync trap).
export const UNSCOPED_SUBSET: DirectoryUser[] = USERS.slice(0, 3)
