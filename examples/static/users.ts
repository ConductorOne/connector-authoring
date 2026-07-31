import {newUserResource} from "@baton/types"
import {annotations} from "@baton/helpers"
import {resourceType, walk} from "@baton/runtime"

import {USERS} from "./data"

// No nodes and an empty `from` means the walker runs exactly once against a
// single seed row; returning an array emits every user in one pass.
const resources = walk({
    from: {},
    to: () =>
        USERS.map((user) =>
            newUserResource(user.displayName, "user", user.id, {
                status: {
                    status: "STATUS_ENABLED",
                },
                accountType: "ACCOUNT_TYPE_HUMAN",
                login: user.email,
                emails: [{address: user.email, isPrimary: true}],
                profile: {
                    user_id: user.id,
                    email: user.email,
                },
            }),
        ),
})

export const userType = resourceType({
    id: "user",
    displayName: "User",
    traits: ["TRAIT_USER"],
    annotations: [annotations.skipEntitlementsAndGrants()],
    resources,
})
