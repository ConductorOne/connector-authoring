import {annotations, entitlementId, grantId} from "@baton/helpers"
import {
    config,
    connector,
    http,
    node,
    type PublicConfigField,
    resourceType,
    type RuntimeGrant,
    scope,
    type SecretConfigField,
    slot,
    walk,
} from "@baton/runtime"
import {
    newGroupResource,
    newResourceId,
    newUserResource,
    type ResourceTypeReference,
    TRAIT_USER,
} from "@baton/types"

type Page<T> = {
    items: readonly T[]
    offset: number
    limit: number
    total: number
}

type DirectoryUser = {id: string; name: string; email: string; active: boolean}
type DirectoryGroup = {id: string; name: string}
type DirectoryMember = {userId: string}

// These casts classify low-level config references as public or secret;
// generated accessors normally carry this typing. The values remain opaque
// references and are resolved only by the hosted runtime.
const baseUrl = config("base-url") as PublicConfigField<string, "base-url">
const accountEmail = config("account-email") as PublicConfigField<string, "account-email">
const apiToken = config("api-token") as SecretConfigField<string, "api-token">

const directory = http.v1({
    baseUrl,
    auth: {type: "basic", username: accountEmail, password: apiToken},
    headers: {Accept: "application/json"},
})

const offsetPagination = {
    kind: "offset" as const,
    offsetParam: "offset",
    pageSizeParam: "limit",
    pageSize: 100,
    startAtPath: ["offset"] as const,
    maxResultsPath: ["limit"] as const,
    totalPath: ["total"] as const,
}

const userRow = slot<DirectoryUser>()
const groupRow = slot<DirectoryGroup>()
const memberRow = slot<DirectoryMember>()

const listUsers = node({
    outputs: {userRow},
    run: () => directory.GET({path: "/v1/users", pagination: offsetPagination}),
    result: ({response}) =>
        (response as Page<DirectoryUser>).items.map((user) => ({userRow: user})),
})

const listGroups = node({
    outputs: {groupRow},
    run: () => directory.GET({path: "/v1/groups", pagination: offsetPagination}),
    result: ({response}) =>
        (response as Page<DirectoryGroup>).items.map((group) => ({groupRow: group})),
})

const listGroupMembers = node({
    inputs: {group: scope.resource},
    outputs: {memberRow},
    // This constructs a request descriptor from graph input; it does not
    // perform HTTP in connector code.
    run: ({group}) =>
        directory.GET({
            path: `/v1/groups/${encodeURIComponent(group.id)}/members`,
            pagination: offsetPagination,
        }),
    result: ({response}) =>
        (response as Page<DirectoryMember>).items.map((member) => ({memberRow: member})),
})

const userGrantableTo: readonly ResourceTypeReference[] = [
    {
        id: "user",
        displayName: "User",
        traits: [TRAIT_USER],
        annotations: [annotations.skipEntitlementsAndGrants()],
    },
]

const users = walk({
    nodes: [listUsers],
    from: {userRow},
    to: ({userRow: user}) =>
        newUserResource(user.name, "user", user.id, {
            status: {status: user.active ? "STATUS_ENABLED" : "STATUS_DISABLED"},
            accountType: "ACCOUNT_TYPE_HUMAN",
            login: user.email,
            emails: [{address: user.email, isPrimary: true}],
            profile: user,
        }),
})

const groups = walk({
    nodes: [listGroups],
    from: {groupRow},
    to: ({groupRow: group}) =>
        newGroupResource(group.name, "group", group.id, {profile: group}),
})

const MEMBER_SLUG = "member"

const groupEntitlements = walk({
    from: {group: scope.resource},
    to: ({group}) => ({
        id: entitlementId("group", group.id, MEMBER_SLUG),
        displayName: `${group.displayName} Member`,
        description: `Member of the ${group.displayName} group`,
        purpose: "PURPOSE_VALUE_ASSIGNMENT" as const,
        grantableTo: userGrantableTo,
        slug: MEMBER_SLUG,
    }),
})

const groupGrants = walk({
    nodes: [listGroupMembers],
    from: {group: scope.resource, memberRow},
    to: ({group, memberRow: member}): RuntimeGrant => ({
        id: grantId(entitlementId("group", group.id, MEMBER_SLUG), "user", member.userId),
        entitlement: {id: entitlementId("group", group.id, MEMBER_SLUG)},
        principal: {id: newResourceId("user", member.userId)},
    }),
})

const userType = resourceType({
    id: "user",
    displayName: "User",
    traits: ["TRAIT_USER"],
    annotations: [annotations.skipEntitlementsAndGrants()],
    resources: users,
})

const groupType = resourceType({
    id: "group",
    displayName: "Group",
    traits: ["TRAIT_GROUP"],
    resources: groups,
    entitlements: groupEntitlements,
    grants: groupGrants,
})

export default connector({
    metadata: {
        displayName: "Directory API",
        description: "Sync users, groups, and group memberships from a declarative HTTP graph.",
    },
    transports: {directory},
    resourceTypes: [userType, groupType],
})
