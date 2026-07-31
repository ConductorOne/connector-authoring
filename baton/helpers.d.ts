import type {
  AppTraitFlag,
  AppTraitAnnotation,
  AssetRef,
  CredentialRotationResultResponse,
  CreateResourceResponse,
  DeleteResourceResponse,
  Grant,
  GrantAnnotation,
  GrantManagerServiceGrantResponse,
  GrantManagerServiceRevokeResponse,
  GroupTraitAnnotation,
  ProtoAnnotation,
  Resource,
  RoleScopeCondition,
  RoleScopeConditions,
  ResourceAnnotation,
  ResourceGetterServiceGetResourceResponse,
  ResourceId,
  RoleTraitAnnotation,
  SecretTraitAnnotation,
  SecretTraitCredentialType,
  NonHumanIdentityTraitAnnotation,
  NonHumanIdentityTraitNhiType,
  SkipEntitlementsAndGrantsAnnotation,
  SkipEntitlementsAnnotation,
  SkipGrantsAnnotation,
  Ticket,
  TicketAnnotation,
  TicketSchema,
  TicketsServiceCreateTicketResponse,
  TicketsServiceGetTicketResponse,
  TicketsServiceGetTicketSchemaResponse,
  TicketsServiceListTicketSchemasResponse,
  UserTraitAccountType,
  UserTraitAnnotation,
  UserTraitEmail,
  UserTraitMFAStatus,
  UserTraitSSOStatus,
  UserTraitStatusCode,
  UserTraitStatusValue,
  UserTraitStructuredName,
} from "./types";
import type {
  CreateAccountResponse_ActionRequiredResult,
  CreateAccountResponse_AlreadyExistsResult,
  CreateAccountResponse_InProgressResult,
  CreateAccountResponse_SuccessResult,
  PlaintextData,
} from "./sdk-types";

/**
 * Helpers for constructing common Baton trait annotations.
 */
export declare const traits: {
  /**
   * Returns a user trait annotation with optional status overrides.
   */
  user(options?: {
    /**
     * The Baton account status to attach to the user trait.
     */
    status?: UserTraitStatusCode | UserTraitStatusValue;
    /**
     * The Baton account type to attach to the user trait.
     */
    accountType?: UserTraitAccountType;
    emails?: readonly UserTraitEmail[];
    profile?: Readonly<Record<string, unknown>>;
    icon?: AssetRef;
    login?: string;
    loginAliases?: readonly string[];
    employeeIds?: readonly string[];
    createdAt?: string | Date;
    lastLogin?: string | Date;
    mfaStatus?: UserTraitMFAStatus;
    ssoStatus?: UserTraitSSOStatus;
    structuredName?: UserTraitStructuredName;
  }): UserTraitAnnotation;
  /**
   * Returns a group trait annotation.
   */
  group(options?: {
    /**
     * Optional free-form group profile to attach to the trait.
     */
    profile?: Readonly<Record<string, unknown>>;
    icon?: AssetRef;
  }): GroupTraitAnnotation;
  /**
   * Returns a role trait annotation.
   */
  role(options?: {
    /**
     * Optional free-form role profile to attach to the trait.
     */
    profile?: Readonly<Record<string, unknown>>;
    roleScopeConditions?: RoleScopeConditions | {
      type: string;
      conditions: readonly (RoleScopeCondition | string)[];
    };
  }): RoleTraitAnnotation;
  /**
   * Returns an app trait annotation.
   */
  app(options?: {
    helpUrl?: string;
    icon?: AssetRef;
    logo?: AssetRef;
    profile?: Readonly<Record<string, unknown>>;
    flags?: readonly AppTraitFlag[];
  }): AppTraitAnnotation;
  /**
   * Returns a secret trait annotation.
   */
  secret(options?: {
    profile?: Readonly<Record<string, unknown>>;
    createdAt?: string | Date;
    expiresAt?: string | Date;
    lastUsedAt?: string | Date;
    createdBy?: ResourceId;
    identity?: ResourceId;
    credentialType?: SecretTraitCredentialType;
    credentialDetail?: string;
  }): SecretTraitAnnotation;
  /**
   * Returns a non-human-identity trait annotation. Kind-agnostic: attach it
   * via a resource's `annotations` array on any resource (e.g. alongside an
   * app, role, user, or secret trait), mirroring the SDK's `WithNHIType`.
   */
  nonHumanIdentity(options?: {
    nhiType?: NonHumanIdentityTraitNhiType;
    nhiDetail?: string;
  }): NonHumanIdentityTraitAnnotation;
};

/**
 * Frozen single-entry annotation arrays for common Baton resource traits.
 */
export declare const resourceAnnotations: {
  /**
   * A frozen resource-annotation array for user resources.
   */
  readonly user: readonly [UserTraitAnnotation];
  /**
   * A frozen resource-annotation array for group resources.
   */
  readonly group: readonly [GroupTraitAnnotation];
  /**
   * A frozen resource-annotation array for role resources.
   */
  readonly role: readonly [RoleTraitAnnotation];
  /**
   * A frozen resource-annotation array for app resources.
   */
  readonly app: readonly [AppTraitAnnotation];
  /**
   * A frozen resource-annotation array for secret resources.
   */
  readonly secret: readonly [SecretTraitAnnotation];
};

import type { GeneratedAnnotations } from "./generated-annotation-helpers";
import type {
  Ticket as TicketDU,
  TicketCustomField as TicketCustomFieldDU,
  TicketSchema as TicketSchemaDU,
  TicketStatus as TicketStatusDU,
  TicketType as TicketTypeDU,
} from "@baton/types";

/**
 * Helpers for constructing common Baton annotations that are not traits.
 *
 * The base surface is generated from the Protobuf schema - see
 * `runtime/baton/generated-annotation-helpers.d.ts` and
 * `pkg/jsruntime/generated_annotation_helpers.go`. A handful of helpers are
 * overridden or extended here:
 *
 *   * `grantExpandable` uses snake_case field names in its Protobuf-JSON
 *     output and cannot be schema-generated cleanly; the hand-rolled
 *     implementation translates camelCase TS input to snake_case output.
 *
 *   * `childResourceTypes` is a variadic convenience over the generated
 *     `childResourceType` singular; the Protobuf schema has no "list of
 *     child resource types" message to derive it from.
 *
 *   * The Ticket* family is overridden to return the richer discriminated
 *     union types from `@baton/types` rather than the flatter auto-generated
 *     shapes. This lets connector emit sites (e.g. jira/ticketing.ts) type-
 *     check against the hand-curated unions that the ticketing DSL expects.
 */
export declare const annotations:
  & Omit<
      GeneratedAnnotations,
      "externalLink" | "ticket" | "ticketCustomField" | "ticketSchema" | "ticketStatus" | "ticketType"
    >
  & {
    /**
     * Declares an external link annotation. When omitted, the wire shape
     * contains only the annotation type URL with no `url` field.
     */
    externalLink(url?: string): ExternalLink;
    /**
     * Declares that a grant can be expanded through the provided entitlements.
     */
    grantExpandable(input: {
      /**
       * Entitlement IDs that expand the grant.
       */
      entitlementIds: readonly string[];
      /**
       * Whether expansion should stay shallow.
       */
      shallow?: boolean;
      /**
       * Resource type IDs produced by the expansion.
       */
      resourceTypeIds: readonly string[];
    }): GrantAnnotation;
    /**
     * Variadic convenience: returns an array of ChildResourceType annotations.
     * Spread into an annotations array when declaring multiple children in a
     * single resource-type definition.
     */
    childResourceTypes(...resourceTypeIds: string[]): readonly ProtoAnnotation[];
    /**
     * Ticket family overrides. The `@baton/types` surface declares these as
     * discriminated unions (for TicketCustomField) or with stricter read-
     * only field shapes (for TicketSchema) than the auto-generated flat
     * interfaces. Connector emit sites (e.g. jira/ticketing.ts) consume
     * the curated types, so helpers that produce those values use the
     * curated types here to avoid cross-file type-source mismatch.
     */
    ticket<T extends Omit<TicketDU, "@type">>(spec: T): TicketDU;
    ticketCustomField<T extends Omit<TicketCustomFieldDU, "@type">>(spec: T): TicketCustomFieldDU;
    ticketSchema<T extends Omit<TicketSchemaDU, "@type">>(spec: T): TicketSchemaDU;
    ticketStatus<T extends Omit<TicketStatusDU, "@type">>(spec: T): TicketStatusDU;
    ticketType<T extends Omit<TicketTypeDU, "@type">>(spec: T): TicketTypeDU;
  };

/**
 * Builds the canonical Baton entitlement ID from a resource type, the emitted
 * resource's `id.resource` value, and an entitlement slug.
 */
export declare function entitlementId(
  resourceTypeId: string,
  resourceId: string,
  slug: string,
): string;

/**
 * Builds the canonical Baton resource ID from a resource type and the emitted
 * @param resourceTypeId
 * @param resource
 */
export declare function resourceId(
    resourceTypeId: string,
    resource: string,
): ResourceId

/**
 * Builds the canonical Baton grant ID from an entitlement ID plus the
 * principal resource's `id.resourceType` and `id.resource` values.
 */
export declare function grantId(
  entitlementId: string,
  principalType: string,
  principalId: string,
): string;

/**
 * Maps values while omitting nullish results.
 */
export declare function filterMap<T, U>(
  values: readonly T[],
  mapper: (value: T, index: number) => U | null | undefined,
): U[];

/**
 * Small helpers for constructing strongly typed ticketing service responses.
 */
export declare const ticketingResponse: {
  listTicketSchemas(input: {
    readonly list: readonly TicketSchema[];
    readonly nextPageToken?: string;
    readonly annotations?: readonly TicketAnnotation[];
  }): TicketsServiceListTicketSchemasResponse;
  getTicketSchema(input: {
    readonly schema?: TicketSchema;
    readonly annotations?: readonly TicketAnnotation[];
  }): TicketsServiceGetTicketSchemaResponse;
  createTicket(input: {
    readonly ticket?: Ticket;
    readonly annotations?: readonly TicketAnnotation[];
    readonly error?: string;
  }): TicketsServiceCreateTicketResponse;
  getTicket(input: {
    readonly ticket?: Ticket;
    readonly annotations?: readonly TicketAnnotation[];
    readonly error?: string;
  }): TicketsServiceGetTicketResponse;
};

/**
 * Small helpers for constructing strongly typed provisioning service responses.
 */
export declare const provisioningResponse: {
  grant(input: {
    readonly grants?: readonly Grant[];
    readonly annotations?: readonly ProtoAnnotation[];
  }): GrantManagerServiceGrantResponse;
  revoke(input: {
    readonly annotations?: readonly ProtoAnnotation[];
  }): GrantManagerServiceRevokeResponse;
};

/**
 * Small helpers for constructing strongly typed resource lifecycle responses.
 */
export declare const resourceResponse: {
  get(input: {
    readonly resource?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
  }): ResourceGetterServiceGetResourceResponse;
  create(input: {
    readonly created?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
  }): CreateResourceResponse;
  delete(input: {
    readonly annotations?: readonly ProtoAnnotation[];
  }): DeleteResourceResponse;
};

/**
 * Small helpers for constructing strongly typed create-account result variants.
 */
export declare const accountResponse: {
  success(input: {
    readonly resource?: Resource;
    readonly plaintextData?: readonly PlaintextData[];
    readonly annotations?: readonly ProtoAnnotation[];
  }): {
    readonly success: CreateAccountResponse_SuccessResult;
    readonly plaintextData?: readonly PlaintextData[];
    readonly annotations?: readonly ProtoAnnotation[];
  };
  alreadyExists(input: {
    readonly resource?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
  }): {
    readonly alreadyExists: CreateAccountResponse_AlreadyExistsResult;
    readonly annotations?: readonly ProtoAnnotation[];
  };
  inProgress(input: {
    readonly resource?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
  }): {
    readonly inProgress: CreateAccountResponse_InProgressResult;
    readonly annotations?: readonly ProtoAnnotation[];
  };
  actionRequired(input: {
    readonly message: CreateAccountResponse_ActionRequiredResult["message"];
    readonly resource?: Resource;
    readonly annotations?: readonly ProtoAnnotation[];
  }): {
    readonly actionRequired: CreateAccountResponse_ActionRequiredResult;
    readonly annotations?: readonly ProtoAnnotation[];
  };
};

/**
 * Small helpers for constructing strongly typed credential-rotation responses.
 */
export declare const credentialResponse: {
  rotate(input: {
    readonly resourceId?: ResourceId;
    readonly plaintextData?: readonly PlaintextData[];
    readonly annotations?: readonly ProtoAnnotation[];
    readonly error?: string;
  }): CredentialRotationResultResponse;
};

/**
 * Re-export of the shared resource annotation union type.
 */
export type { ResourceAnnotation };
