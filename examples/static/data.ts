import {type ResourceTypeReference, TRAIT_USER} from "@baton/types"
import {annotations} from "@baton/helpers"

// Hardcoded dataset shared by every resource type in this connector. Grants
// reference users by id, so membership lives next to the resource it belongs
// to and both walkers read from the same source of truth.

export interface StaticUser {
    readonly id: string
    readonly displayName: string
    readonly email: string
}

export const USERS: readonly StaticUser[] = [
    {id: "alice", displayName: "Alice Anderson", email: "alice@example.com"},
    {id: "bob", displayName: "Bob Barker", email: "bob@example.com"},
    {id: "carol", displayName: "Carol Chen", email: "carol@example.com"},
]

export interface StaticGroup {
    readonly id: string
    readonly displayName: string
    readonly members: readonly string[]
}

export const GROUPS: readonly StaticGroup[] = [
    {id: "engineering", displayName: "Engineering", members: ["alice", "bob"]},
    {id: "sales", displayName: "Sales", members: ["carol"]},
]

export interface StaticRole {
    readonly id: string
    readonly displayName: string
    readonly assignees: readonly string[]
}

export const ROLES: readonly StaticRole[] = [
    {id: "admin", displayName: "Admin", assignees: ["alice"]},
    {id: "viewer", displayName: "Viewer", assignees: ["bob", "carol"]},
]

export const userGrantableTo: readonly ResourceTypeReference[] = [
    {
        id: "user",
        displayName: "User",
        traits: [TRAIT_USER],
        annotations: [annotations.skipEntitlementsAndGrants()],
    },
]
