import {type Entitlement, newGroupResource, newResourceId} from "@baton/types"
import {entitlementId, grantId} from "@baton/helpers"
import {resourceType, type RuntimeGrant, scope, walk} from "@baton/runtime"

import {GROUPS, userGrantableTo} from "./data"

type RuntimeEntitlement = Omit<Entitlement, "resource">

const MEMBER_SLUG = "member"

const resources = walk({
    from: {},
    to: () =>
        GROUPS.map((group) =>
            newGroupResource(group.displayName, "group", group.id, {
                profile: {
                    id: group.id,
                    name: group.displayName,
                },
            }),
        ),
})

const entitlements = walk({
    from: {
        resource: scope.resource,
    },
    to: ({resource}): RuntimeEntitlement => ({
        id: entitlementId("group", resource.id, MEMBER_SLUG),
        displayName: `${resource.displayName} Member`,
        description: `Member of the ${resource.displayName} group`,
        purpose: "PURPOSE_VALUE_ASSIGNMENT",
        grantableTo: userGrantableTo,
        slug: MEMBER_SLUG,
    }),
})

const grants = walk({
    from: {
        resource: scope.resource,
    },
    to: ({resource}): readonly RuntimeGrant[] => {
        const group = GROUPS.find((candidate) => candidate.id === resource.id)
        return (group?.members ?? []).map((userId) => ({
            id: grantId(entitlementId("group", resource.id, MEMBER_SLUG), "user", userId),
            entitlement: {
                id: entitlementId("group", resource.id, MEMBER_SLUG),
            },
            principal: {
                id: newResourceId("user", userId),
            },
        }))
    },
})

export const groupType = resourceType({
    id: "group",
    displayName: "Group",
    traits: ["TRAIT_GROUP"],
    resources,
    entitlements,
    grants,
})
