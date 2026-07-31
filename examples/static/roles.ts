import {type Entitlement, newResourceId, newRoleResource} from "@baton/types"
import {entitlementId, grantId} from "@baton/helpers"
import {resourceType, type RuntimeGrant, scope, walk} from "@baton/runtime"

import {ROLES, userGrantableTo} from "./data"

type RuntimeEntitlement = Omit<Entitlement, "resource">

const ASSIGNED_SLUG = "assigned"

const resources = walk({
    from: {},
    to: () =>
        ROLES.map((role) =>
            newRoleResource(role.displayName, "role", role.id, {
                profile: {
                    id: role.id,
                    name: role.displayName,
                },
            }),
        ),
})

const entitlements = walk({
    from: {
        resource: scope.resource,
    },
    to: ({resource}): RuntimeEntitlement => ({
        id: entitlementId("role", resource.id, ASSIGNED_SLUG),
        displayName: `${resource.displayName} Role`,
        description: `Assigned the ${resource.displayName} role`,
        purpose: "PURPOSE_VALUE_ASSIGNMENT",
        grantableTo: userGrantableTo,
        slug: ASSIGNED_SLUG,
    }),
})

const grants = walk({
    from: {
        resource: scope.resource,
    },
    to: ({resource}): readonly RuntimeGrant[] => {
        const role = ROLES.find((candidate) => candidate.id === resource.id)
        return (role?.assignees ?? []).map((userId) => ({
            id: grantId(entitlementId("role", resource.id, ASSIGNED_SLUG), "user", userId),
            entitlement: {
                id: entitlementId("role", resource.id, ASSIGNED_SLUG),
            },
            principal: {
                id: newResourceId("user", userId),
            },
        }))
    },
})

export const roleType = resourceType({
    id: "role",
    displayName: "Role",
    traits: ["TRAIT_ROLE"],
    resources,
    entitlements,
    grants,
})
