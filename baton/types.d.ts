export interface ProtoAnnotation {
    readonly "@type": string;

    readonly [key: string]: unknown;
}

export type ResourceTypeTrait =
    | "TRAIT_USER"
    | "TRAIT_GROUP"
    | "TRAIT_ROLE"
    | "TRAIT_APP"
    | "TRAIT_SECRET"
    | "TRAIT_SECURITY_INSIGHT"
    | "TRAIT_SCOPE_BINDING"
    | "TRAIT_MANAGED_DEVICE";

export declare const TRAIT_USER: "TRAIT_USER";
export declare const TRAIT_GROUP: "TRAIT_GROUP";
export declare const TRAIT_ROLE: "TRAIT_ROLE";
export declare const TRAIT_APP: "TRAIT_APP";
export declare const TRAIT_SECRET: "TRAIT_SECRET";
export declare const TRAIT_SECURITY_INSIGHT: "TRAIT_SECURITY_INSIGHT";
export declare const TRAIT_SCOPE_BINDING: "TRAIT_SCOPE_BINDING";
export declare const TRAIT_MANAGED_DEVICE: "TRAIT_MANAGED_DEVICE";

export interface ResourceId {
    readonly resourceType: string;
    readonly resource: string;
    readonly batonResource?: boolean;
}

export function resourceIdLiteral(
    data: Omit<ResourceId, "@type">
): ResourceId {
    return {
        "@type": "type.googleapis.com/c1.connector.v2.ResourceId",
        ...data,
    };
}

export const createResourceId = resourceIdLiteral;

export interface NewResourceOptions {
    readonly parentResourceId?: ResourceId;
    readonly annotations?: readonly ResourceAnnotation[];
    readonly description?: string;
    readonly batonResource?: boolean;
    readonly externalId?: ExternalId;
    readonly creationSource?: ResourceCreationSource;
}

export function newResourceId(
    resourceType: string | ResourceTypeReference,
    objectId: string | number
): ResourceId;

export function joinResourceIdParts(
    ...parts: readonly (string | number)[]
): string;

export function splitResourceIdParts(
    resourceId: string,
    expectedParts?: number
): readonly string[];

export interface AssetRef {
    readonly id: string;
}

export interface ExternalId {
    readonly id: string;
    readonly link?: string;
    readonly description?: string;
}

export type ResourceCreationSource =
    | "CREATION_SOURCE_UNSPECIFIED"
    | "CREATION_SOURCE_CONNECTOR_LIST_RESOURCES"
    | "CREATION_SOURCE_CONNECTOR_LIST_GRANTS_PRINCIPAL_JIT";

export type UserTraitStatusCode =
    | "STATUS_UNSPECIFIED"
    | "STATUS_ENABLED"
    | "STATUS_DISABLED"
    | "STATUS_DELETED";

export type UserTraitAccountType =
    | "ACCOUNT_TYPE_UNSPECIFIED"
    | "ACCOUNT_TYPE_HUMAN"
    | "ACCOUNT_TYPE_SERVICE"
    | "ACCOUNT_TYPE_SYSTEM";

export type SecretTraitCredentialType =
    | "CREDENTIAL_TYPE_UNSPECIFIED"
    | "CREDENTIAL_TYPE_STATIC_SECRET"
    | "CREDENTIAL_TYPE_ASYMMETRIC_KEY"
    | "CREDENTIAL_TYPE_CERTIFICATE";

export type NonHumanIdentityTraitNhiType =
    | "NHI_TYPE_UNSPECIFIED"
    | "NHI_TYPE_APP_REGISTRATION"
    | "NHI_TYPE_ASSUMABLE_ROLE"
    | "NHI_TYPE_MANAGED_IDENTITY";

export interface UserTraitEmail {
    readonly address: string;
    readonly isPrimary?: boolean;
}

export interface UserTraitStatusValue {
    readonly status: UserTraitStatusCode;
    readonly details?: string;
}

export interface UserTraitMFAStatus {
    readonly mfaEnabled: boolean;
}

export interface UserTraitSSOStatus {
    readonly ssoEnabled: boolean;
}

export interface UserTraitStructuredName {
    readonly givenName?: string;
    readonly familyName?: string;
    readonly middleNames?: readonly string[];
    readonly prefix?: string;
    readonly suffix?: string;
}

export interface RoleScopeCondition {
    readonly expression: string;
}

export interface RoleScopeConditions {
    readonly type: string;
    readonly conditions: readonly RoleScopeCondition[];
}

export type AppTraitFlag =
    | "APP_FLAG_UNSPECIFIED"
    | "APP_FLAG_HIDDEN"
    | "APP_FLAG_INACTIVE"
    | "APP_FLAG_SAML"
    | "APP_FLAG_OIDC"
    | "APP_FLAG_BOOKMARK";

export interface UserTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.UserTrait";
    readonly status?: UserTraitStatusValue;
    readonly accountType?: UserTraitAccountType;
    readonly emails?: readonly UserTraitEmail[];
    readonly profile?: Readonly<Record<string, unknown>>;
    readonly icon?: AssetRef;
    readonly login?: string;
    readonly loginAliases?: readonly string[];
    readonly employeeIds?: readonly string[];
    readonly createdAt?: string;
    readonly lastLogin?: string;
    readonly mfaStatus?: UserTraitMFAStatus;
    readonly ssoStatus?: UserTraitSSOStatus;
    readonly structuredName?: UserTraitStructuredName;
}

export interface GroupTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GroupTrait";
    readonly icon?: AssetRef;
    readonly profile?: Readonly<Record<string, unknown>>;
}

export interface RoleTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.RoleTrait";
    readonly profile?: Readonly<Record<string, unknown>>;
    readonly roleScopeConditions?: RoleScopeConditions;
}

export interface AppTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.AppTrait";
    readonly helpUrl?: string;
    readonly icon?: AssetRef;
    readonly logo?: AssetRef;
    readonly profile?: Readonly<Record<string, unknown>>;
    readonly flags?: readonly AppTraitFlag[];
}

export interface SecretTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.SecretTrait";
    readonly profile?: Readonly<Record<string, unknown>>;
    readonly createdAt?: string;
    readonly expiresAt?: string;
    readonly lastUsedAt?: string;
    readonly createdById?: ResourceId;
    readonly identityId?: ResourceId;
    readonly credentialType?: SecretTraitCredentialType;
    readonly credentialDetail?: string;
}

export interface NonHumanIdentityTraitAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.NonHumanIdentityTrait";
    readonly nhiType?: NonHumanIdentityTraitNhiType;
    readonly nhiDetail?: string;
}

export interface GrantExpandableAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GrantExpandable";
    readonly entitlement_ids: readonly string[];
    readonly resource_type_ids: readonly string[];
}

export interface SkipEntitlementsAndGrantsAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.SkipEntitlementsAndGrants";
}

export interface SkipGrantsAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.SkipGrants";
}

export interface SkipEntitlementsAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.SkipEntitlements";
}

export interface ChildResourceTypeAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.ChildResourceType";
    readonly resource_type_id: string;
}

export interface GrantMetadataAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GrantMetadata";
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GrantImmutableAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GrantImmutable";
    readonly source_id?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GrantAlreadyExistsAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GrantAlreadyExists";
}

export interface GrantAlreadyRevokedAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.GrantAlreadyRevoked";
}

export interface InsertResourceGrantsAnnotation extends ProtoAnnotation {
    readonly "@type": "type.googleapis.com/c1.connector.v2.InsertResourceGrants";
}

export type ResourceAnnotation =
    | UserTraitAnnotation
    | GroupTraitAnnotation
    | RoleTraitAnnotation
    | AppTraitAnnotation
  | SecretTraitAnnotation
    | NonHumanIdentityTraitAnnotation
    | SkipEntitlementsAndGrantsAnnotation
    | SkipGrantsAnnotation
    | SkipEntitlementsAnnotation
    | ProtoAnnotation;

export type EntitlementAnnotation = ProtoAnnotation;
export type GrantAnnotation =
    | GrantExpandableAnnotation
    | GrantMetadataAnnotation
    | GrantImmutableAnnotation
    | GrantAlreadyExistsAnnotation
    | GrantAlreadyRevokedAnnotation
    | InsertResourceGrantsAnnotation
    | ProtoAnnotation;

export type ResourceTypeAnnotation =
    | ChildResourceTypeAnnotation
    | SkipEntitlementsAndGrantsAnnotation
    | SkipGrantsAnnotation
    | SkipEntitlementsAnnotation
    | ProtoAnnotation;

export interface ResourceType {
    readonly id: string;
    readonly displayName: string;
    readonly traits?: readonly ResourceTypeTrait[];
    readonly annotations?: readonly ResourceTypeAnnotation[];
    readonly description?: string;
    readonly sourcedExternally?: boolean;
}

export type ResourceTypeReference = ResourceType;

export interface Resource {
    readonly id: ResourceId;
    readonly displayName: string;
    readonly parentResourceId?: ResourceId;
    readonly annotations?: readonly ResourceAnnotation[];
    readonly description?: string;
    readonly batonResource?: boolean;
    readonly externalId?: ExternalId;
    readonly creationSource?: ResourceCreationSource;
}

export interface PrincipalResource extends Omit<Resource, "displayName"> {
    readonly displayName?: string;
}

export interface Entitlement {
    readonly resource: Resource;
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
    readonly purpose:
        | "PURPOSE_VALUE_UNSPECIFIED"
        | "PURPOSE_VALUE_ASSIGNMENT"
        | "PURPOSE_VALUE_PERMISSION"
        | "PURPOSE_VALUE_OWNERSHIP";
    readonly slug?: string;
    readonly grantableTo?: readonly ResourceTypeReference[];
    readonly annotations?: readonly EntitlementAnnotation[];
}

export interface GrantSource {
    readonly isDirect?: boolean;
}

export interface GrantSources {
    readonly sources?: Readonly<Record<string, GrantSource>>;
}

export interface Grant {
    readonly id?: string;
    readonly entitlement: Entitlement;
    readonly principal: PrincipalResource;
    readonly sources?: GrantSources;
    readonly annotations?: readonly GrantAnnotation[];
}

export function resourceLiteral(
    data: Omit<Resource, "@type">
): Resource {
    return {
        "@type": "type.googleapis.com/c1.connector.v2.Resource",
        ...data,
    };
}

export const createResource = resourceLiteral;

export function newResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    options?: NewResourceOptions
): Resource;

export function newUserResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    userTrait?: Omit<UserTraitAnnotation, "@type">,
    options?: NewResourceOptions
): Resource;

export function newGroupResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    groupTrait?: Omit<GroupTraitAnnotation, "@type">,
    options?: NewResourceOptions
): Resource;

export function newRoleResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    roleTrait?: Omit<RoleTraitAnnotation, "@type">,
    options?: NewResourceOptions
): Resource;

export function newAppResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    appTrait?: Omit<AppTraitAnnotation, "@type">,
    options?: NewResourceOptions
): Resource;

export function newSecretResource(
    displayName: string,
    resourceType: string | ResourceTypeReference,
    objectId: string | number,
    secretTrait?: Omit<SecretTraitAnnotation, "@type">,
    options?: NewResourceOptions
): Resource;

export function createEntitlement(
    data: Omit<Entitlement, "@type">
): Entitlement {
    return {
        "@type": "type.googleapis.com/c1.connector.v2.Entitlement",
        ...data,
    };
}

export function createGrant(
    data: Omit<Grant, "@type">
): Grant {
    return {
        "@type": "type.googleapis.com/c1.connector.v2.Grant",
        ...data,
    };
}

export type TicketAnnotation = ProtoAnnotation;

export interface TicketStatus {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketStatus";
    readonly id: string;
    readonly displayName: string;
}

export interface TicketType {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketType";
    readonly id: string;
    readonly displayName: string;
}

export interface TicketCustomFieldObjectValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldObjectValue";
    readonly id: string;
    readonly displayName: string;
}

interface TicketCustomFieldBase {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomField";
    readonly id: string;
    readonly displayName?: string;
    readonly required?: boolean;
    readonly annotations?: readonly TicketAnnotation[];
}

interface TicketCustomFieldStringValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldStringValue";
    readonly value?: string;
    readonly defaultValue?: string;
}

interface TicketCustomFieldStringValues {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldStringValues";
    readonly value?: string;
    readonly defaultValue?: string;
    readonly values?: readonly string[];
    readonly defaultValues?: readonly string[];
}

interface TicketCustomFieldBoolValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldBoolValue";
    readonly value?: boolean;
}

interface TicketCustomFieldNumberValueField {
    readonly value: number;
}

interface TicketCustomFieldNumberValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldNumberValue";
    readonly value?: TicketCustomFieldNumberValueField;
    readonly defaultValue?: TicketCustomFieldNumberValueField;
}

interface TicketCustomFieldTimestampValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldTimestampValue";
    readonly value?: string;
    readonly defaultValue?: string;
}

interface TicketCustomFieldPickStringValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldPickStringValue";
    readonly value?: string;
    readonly allowedValues?: readonly string[];
    readonly defaultValue?: string;
}

interface TicketCustomFieldPickMultipleStringValues {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldPickMultipleStringValues";
    readonly values?: readonly string[];
    readonly allowedValues?: readonly string[];
    readonly defaultValues?: readonly string[];
}

interface TicketCustomFieldPickObjectValue {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldPickObjectValue";
    readonly value?: TicketCustomFieldObjectValue;
    readonly allowedValues?: readonly TicketCustomFieldObjectValue[];
    readonly defaultValue?: TicketCustomFieldObjectValue;
}

interface TicketCustomFieldPickMultipleObjectValues {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketCustomFieldPickMultipleObjectValues";
    readonly values?: readonly TicketCustomFieldObjectValue[];
    readonly allowedValues?: readonly TicketCustomFieldObjectValue[];
    readonly defaultValues?: readonly TicketCustomFieldObjectValue[];
}

export type TicketCustomField =
    | (TicketCustomFieldBase & {
        readonly stringValue: TicketCustomFieldStringValue;
    })
    | (TicketCustomFieldBase & {
        readonly stringValues: TicketCustomFieldStringValues;
    })
    | (TicketCustomFieldBase & {
        readonly boolValue: TicketCustomFieldBoolValue;
    })
    | (TicketCustomFieldBase & {
        readonly numberValue: TicketCustomFieldNumberValue;
    })
    | (TicketCustomFieldBase & {
        readonly timestampValue: TicketCustomFieldTimestampValue;
    })
    | (TicketCustomFieldBase & {
        readonly pickStringValue: TicketCustomFieldPickStringValue;
    })
    | (TicketCustomFieldBase & {
        readonly pickMultipleStringValues: TicketCustomFieldPickMultipleStringValues;
    })
    | (TicketCustomFieldBase & {
        readonly pickObjectValue: TicketCustomFieldPickObjectValue;
    })
    | (TicketCustomFieldBase & {
        readonly pickMultipleObjectValues: TicketCustomFieldPickMultipleObjectValues;
    });

export interface TicketSchema {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.TicketSchema";
    readonly id: string;
    readonly displayName: string;
    readonly types?: readonly TicketType[];
    readonly statuses?: readonly TicketStatus[];
    readonly customFields?: Readonly<Record<string, TicketCustomField>>;
    readonly annotations?: readonly TicketAnnotation[];
}

export interface Ticket {
    readonly "@type"?: "type.googleapis.com/c1.connector.v2.Ticket";
    readonly id?: string;
    readonly displayName: string;
    readonly description?: string;
    readonly assignees?: readonly Resource[];
    readonly reporter?: Resource;
    readonly status?: TicketStatus;
    readonly type?: TicketType;
    readonly labels?: readonly string[];
    readonly url?: string;
    readonly customFields: Readonly<Record<string, TicketCustomField>>;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly completedAt?: string;
    readonly requestedFor?: Resource;
}

export interface TicketRequest {
    readonly displayName: string;
    readonly description?: string;
    readonly status?: TicketStatus;
    readonly type?: TicketType;
    readonly labels?: readonly string[];
    readonly customFields?: Readonly<Record<string, TicketCustomField>>;
    readonly requestedFor?: Resource;
}

export interface TicketsServiceListTicketSchemasResponse {
    readonly list: readonly TicketSchema[];
    readonly nextPageToken?: string;
    readonly annotations?: readonly TicketAnnotation[];
}

export interface TicketsServiceGetTicketSchemaResponse {
    readonly schema?: TicketSchema;
    readonly annotations?: readonly TicketAnnotation[];
}

export interface TicketsServiceCreateTicketResponse {
    readonly ticket?: Ticket;
    readonly annotations?: readonly TicketAnnotation[];
    readonly error?: string;
}

export interface TicketsServiceGetTicketResponse {
    readonly ticket?: Ticket;
    readonly annotations?: readonly TicketAnnotation[];
    readonly error?: string;
}

export interface GrantManagerServiceGrantResponse {
    readonly grants?: readonly Grant[];
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface GrantManagerServiceRevokeResponse {
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface ResourceGetterServiceGetResourceResponse {
    readonly resource?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface CreateResourceResponse {
    readonly created?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface DeleteResourceResponse {
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface CreateAccountResultResponse {
    readonly success?: CreateAccountResponse_SuccessResult;
    readonly actionRequired?: CreateAccountResponse_ActionRequiredResult;
    readonly alreadyExists?: CreateAccountResponse_AlreadyExistsResult;
    readonly inProgress?: CreateAccountResponse_InProgressResult;
    readonly plaintextData?: readonly PlaintextData[];
    readonly annotations?: readonly ProtoAnnotation[];
}

export interface CredentialRotationResultResponse {
    readonly resourceId?: ResourceId;
    readonly plaintextData?: readonly PlaintextData[];
    readonly annotations?: readonly ProtoAnnotation[];
    readonly error?: string;
}

export interface ConnectorServiceValidateResponse {
    readonly sdkVersion?: string;
    readonly annotations?: readonly ProtoAnnotation[];
}

export type EventType = "USAGE" | "RESOURCE_CHANGE" | "CREATE_GRANT" | "CREATE_REVOKE";
