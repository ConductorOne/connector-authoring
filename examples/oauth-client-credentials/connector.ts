import {annotations} from "@baton/helpers"
import {
    config,
    connector,
    http,
    node,
    type PublicConfigField,
    resourceType,
    type SecretConfigField,
    slot,
    strings,
    walk,
} from "@baton/runtime"
import {newUserResource} from "@baton/types"

type DirectoryUser = {id: string; name: string; email: string; active: boolean}

// Keep this bare config reference as the transport baseUrl: C1 resolves it
// at serve time to derive the permitted egress host. An expression alone
// in tokenUrl does not provide a resolvable host declaration.
const baseUrl = config("base-url") as PublicConfigField<string, "base-url">
const clientId = config("directory-client-id") as PublicConfigField<string, "directory-client-id">
const clientSecret = config("directory-client-secret") as SecretConfigField<string, "directory-client-secret">

const directory = http.v2({
    baseUrl,
    auth: {
        type: "oauth2_client_credentials",
        tokenUrl: strings.concat(baseUrl, "/oauth/token"),
        clientId,
        clientSecret,
        clientAuthStyle: "body",
        tokenRequestContentType: "application/json",
        form: {audience: strings.concat(baseUrl, "/v1/")},
    },
    headers: {Accept: "application/json"},
})

const userRow = slot<DirectoryUser>()
const listUsers = node({
    outputs: {userRow},
    run: () => directory.GET({
        path: "/v1/users",
        itemsPath: ["items"],
        pagination: {
            kind: "offset",
            offsetParam: "offset",
            pageSizeParam: "limit",
            pageSize: 100,
            startAtPath: ["offset"],
            maxResultsPath: ["limit"],
            totalPath: ["total"],
        },
    }),
    result: ({response}) =>
        (response as readonly DirectoryUser[]).map((user) => ({userRow: user})),
})
const users = walk({
    nodes: [listUsers],
    from: {userRow},
    to: ({userRow: user}) => newUserResource(user.name, "user", user.id, {
        status: {status: user.active ? "STATUS_ENABLED" : "STATUS_DISABLED"},
        accountType: "ACCOUNT_TYPE_HUMAN",
        login: user.email,
        emails: [{address: user.email, isPrimary: true}],
        profile: user,
    }),
})
const userType = resourceType({
    id: "user",
    displayName: "User",
    traits: ["TRAIT_USER"],
    annotations: [annotations.skipEntitlementsAndGrants()],
    resources: users,
})

export default connector({
    metadata: {
        displayName: "OAuth Directory API",
        description: "A single-base-URL OAuth client-credentials user sync example.",
    },
    transports: {directory},
    resourceTypes: [userType],
})
