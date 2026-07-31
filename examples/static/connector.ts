import {connector} from "@baton/runtime"

import {groupType} from "./groups"
import {roleType} from "./roles"
import {userType} from "./users"

// Fixture connector: every resource type returns hardcoded data and no
// transports or config fields are declared, so it syncs with zero setup.
const staticConnector = connector({
    metadata: {
        displayName: "Static",
        description: "Static fixture connector with hardcoded users, groups, and roles for testing.",
    },
    resourceTypes: [userType, groupType, roleType],
})

export default staticConnector
