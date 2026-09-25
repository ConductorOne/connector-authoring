import type {
  AccountInfo,
  CapabilityDetailCredentialOption,
  CreateAccountResultResponse,
  CreateResourceResponse,
  CredentialRotationResultResponse,
  DeleteResourceResponse,
  Entitlement,
  EntitlementAnnotation,
  Grant,
  GrantManagerServiceGrantResponse,
  GrantManagerServiceRevokeResponse,
  ProtoAnnotation,
  Resource,
  ResourceGetterServiceGetResourceResponse,
  ResourceId,
  ResourceTypeAnnotation,
  ResourceTypeReference,
  ResourceTypeTrait,
  LocalCredentialOptions,
  ConnectorServiceValidateResponse,
  Ticket,
  TicketRequest,
  TicketSchema,
  TicketStatus,
  TicketType,
  TicketsServiceCreateTicketResponse,
  TicketsServiceGetTicketResponse,
  TicketsServiceGetTicketSchemaResponse,
  TicketsServiceListTicketSchemasResponse,
} from "@baton/types";

/**
 * A named typed position in the dataflow graph.
 *
 * Identity is by JS reference: two `slot<T>()` calls are two distinct channels.
 * Cross-file sharing is achieved by exporting a slot from one module and
 * importing it elsewhere; the imported JS object reference is the shared
 * identity. Collisions by name are impossible by construction.
 *
 * Slots have no author-facing name or label field. Error messages and debug
 * output identify slots by the enclosing action's input or output key.
 *
 * @typeParam T - The value type that flows through this slot.
 * @typeParam Name - Internal type-level identity, auto-assigned. Authors should not set it.
 */
export interface Slot<T = unknown, Name extends string = string> {
  readonly kind: "slot";
  readonly name: Name;
  // Required phantom brand. Never populated at runtime — the slot() factory
  // returns `{ kind, name }` and the declared return type `Slot<T>` is the
  // authoritative shape. The field exists so `Slot<A>` and `Slot<B>` are
  // structurally distinct; an optional phantom was elided during inference
  // and let wrong-typed result rows slide past `ResolveOutputObject<O>`.
  readonly __value: T;
}

export interface OptionalDependency<S extends Slot<any, any>> {
  readonly kind: "some";
  readonly binding: S;
}

/**
 * aggregate(slot, { by?, max? }) marks an input as a collected row chunk.
 * The authored input key controls the array name seen by run() and result().
 *
 * When the slot's value type is an object, `by` is required and must be a
 * string key of that object - the aggregator groups rows by slot[by]. When
 * the slot's value type is a primitive, `by` is forbidden and grouping uses
 * value equality directly.
 */
export interface AggregateDependency<S extends Slot<any, any>> {
  readonly kind: "aggregate";
  readonly binding: S;
  readonly by?: string;
  readonly max?: number;
  readonly missing?: "explode" | "skip";
}

export interface AggregateSkip {
  readonly kind: "aggregate_skip";
}

type SlotValue<S> = S extends Slot<infer T, any> ? T : never;

export interface CollectOutput<S extends Slot<any, any>> {
  readonly kind: "collect";
  readonly binding: S;
  readonly merge?: (accum: SlotValue<S>, item: SlotValue<S>) => void;
}

/**
 * EndpointKind enumerates every place the runtime can invoke an authored
 * walker. Each value corresponds to exactly one endpoint surface the DSL
 * exposes. `RequestArg`s are tagged with the subset of these in which the
 * runtime actually provides the ambient value, so the type system can reject
 * `scope.resource` used in a `resources:` walker or `scope.parent.id` used in
 * a `grants:` walker.
 */
export type EndpointKind =
  | "resources"
  | "entitlements"
  | "grants"
  | "grant"
  | "revoke"
  | "getResource"
  | "createResource"
  | "deleteResource"
  | "createAccount"
  | "rotateCredential"
  | "validate"
  | "listTicketSchemas"
  | "getTicketSchema"
  | "getTicket"
  | "createTicket"
  | "eventFeed";

export interface RequestArg<
  T = unknown,
  Name extends string = string,
  In extends EndpointKind = EndpointKind,
> {
  readonly kind: "request";
  readonly name: Name;
  // Brand T invariantly so `RequestArg<A>` and `RequestArg<B>` aren't
  // collapsed during inference — same reasoning as Slot's required `__value`.
  readonly __value: T;
  // Brand `In` as a *consumer* of endpoints. Under strict function types,
  // function parameters are contravariant, so a `RequestArg<T, Name, Wider>`
  // is assignable to `RequestArg<T, Name, Narrower>` whenever
  // `Narrower extends Wider` — i.e. the endpoint we're in is one of the
  // endpoints this ambient is provided in. That's exactly the check we want:
  // the slot for `entitlements:` asks for `RequestArg<..., "entitlements">`,
  // and `scope.resource` (tagged "entitlements" | "grants" | ...) satisfies
  // it because "entitlements" is one of its provided endpoints.
  readonly __providedIn: (endpoint: In) => void;
}

export interface RequestParentResource {
  readonly id: string;
  readonly resourceType: string;
}

export interface RequestResource {
  readonly id: string;
  readonly resourceType: string;
  readonly displayName: string;
  readonly parentResource?: RequestParentResource;
}

/**
 * All ambient runtime-provided values, in one namespace. Each field is tagged
 * with the `EndpointKind` subset where it is actually provided, so the
 * endpoint slot types can reject misuse (e.g. `scope.resource` inside a
 * `resources:` walker).
 */
export interface Scope {
  readonly parent: {
    readonly id: RequestArg<string, "parentResourceId", "resources">;
    readonly resource: RequestArg<RequestParentResource, "parentResource", "resources">;
  };

  readonly lookup: {
    readonly resourceId: RequestArg<ResourceId, "resourceId", "getResource">;
    readonly parentResourceId: RequestArg<ResourceId, "parentResourceId", "getResource">;
  };

  readonly create: {
    readonly resource: RequestArg<Resource, "resource", "createResource">;
  };

  readonly delete: {
    readonly resourceId: RequestArg<ResourceId, "resourceId", "deleteResource">;
    readonly parentResourceId: RequestArg<ResourceId, "parentResourceId", "deleteResource">;
  };

  readonly resource: RequestArg<
    RequestResource,
    "resource",
    "entitlements" | "grants" | "grant" | "revoke"
  >;

  readonly entitlement: RequestArg<Entitlement, "entitlement", "grant">;
  readonly principal: RequestArg<Resource, "principal", "grant">;

  readonly grant: RequestArg<Grant, "grant", "revoke">;

  readonly provisioning: {
    readonly account: {
      readonly info: RequestArg<AccountInfo, "accountInfo", "createAccount">;
      readonly resourceTypeId: RequestArg<string, "resourceTypeId", "createAccount">;
      readonly credentialOptions: RequestArg<LocalCredentialOptions, "credentialOptions", "createAccount">;
    };
  };

  readonly credentialRotation: {
    readonly resourceId: RequestArg<ResourceId, "resourceId", "rotateCredential">;
    readonly credentialOptions: RequestArg<LocalCredentialOptions, "credentialOptions", "rotateCredential">;
  };

  readonly ticket: {
    readonly id: RequestArg<string, "id", "getTicket" | "getTicketSchema">;
    readonly request: RequestArg<TicketRequest, "request", "createTicket">;
    readonly schema: RequestArg<TicketSchema, "schema", "createTicket">;
    readonly pageSize: RequestArg<number, "pageSize", "listTicketSchemas">;
    readonly pageToken: RequestArg<string, "pageToken", "listTicketSchemas">;
  };

  readonly feed: {
    readonly id: RequestArg<string, "eventFeedId", "eventFeed">;
    readonly cursor: RequestArg<string, "cursor", "eventFeed">;
    readonly startAt: RequestArg<string, "startAt", "eventFeed">;
    readonly pageSize: RequestArg<number, "pageSize", "eventFeed">;
  };
}

export interface ConfigField<T = unknown, Name extends string = string> {
  readonly kind: "config";
  readonly name: Name;
  readonly __value?: T;
}

declare const publicConfigFieldBrand: unique symbol;
declare const secretConfigFieldBrand: unique symbol;

export interface PublicConfigField<T = unknown, Name extends string = string>
  extends ConfigField<T, Name> {
  readonly [publicConfigFieldBrand]: true;
}

export interface SecretConfigField<T = unknown, Name extends string = string>
  extends ConfigField<T, Name> {
  readonly [secretConfigFieldBrand]: true;
}

export interface Transport {
  readonly kind?: "transport";
  readonly name?: string;
  readonly spec?: unknown;
}

// TransportKind / OperationKind are generated from pkg/transport.
// Connectors continue importing them from @baton/runtime; the local
// re-exports forward to the ambient TransportDefaults namespace
// declared in runtime/engine/transport-defaults.generated.ts so
// the Go-side constants stay the single source of truth.
export type TransportKind = TransportDefaults.TransportKind;
export type OperationKind = TransportDefaults.OperationKind;
export type OperationFieldType = "string" | "number" | "boolean" | "object" | "array";

export interface OperationFieldRuntimeSpec {
  readonly type?: OperationFieldType;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
}

export interface HttpOperationRequestRuntimeSpec {
  readonly path?: Record<string, OperationFieldRuntimeSpec>;
  readonly query?: Record<string, OperationFieldRuntimeSpec>;
  readonly headers?: Record<string, OperationFieldRuntimeSpec>;
  readonly body?: {
    readonly required?: boolean;
  };
}

export interface RawHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Record<string, unknown>;
  readonly headers?: Record<string, unknown>;
  readonly body?: unknown;
}

export interface OperationHandle<
  TransportRequest = unknown,
  Response = unknown,
  Request = TransportRequest,
> {
  readonly kind: "operation";
  readonly id: string;
  readonly transportKind: TransportKind;
  readonly operationKind: OperationKind;
  readonly apiId?: string;
  readonly specVersion?: string;
  readonly endpointId?: string;
  readonly method?: string;
  readonly pathTemplate?: string;
  readonly __transportRequest?: TransportRequest;
  readonly __request?: Request;
  readonly __response?: Response;
  readonly __runtimeRequest?: HttpOperationRequestRuntimeSpec;
}

export type ProjectionPolicy = "warn" | "error" | "explode";
export type ProjectionOnNull = "keep" | "drop_field" | "skip_row" | "error";
export type ProjectionOnMissing = "keep" | "drop_field" | "skip_row" | "error";
export type ProjectionPrimitiveType = "string" | "number" | "boolean" | "object" | "array";
export type ProjectionConstValue = string | number | boolean;
export type ProjectionOnNoMatch = "error" | "skip_row";

export interface ProjectionPathFieldRuntimeSpec {
  readonly from: string;
  readonly type?: ProjectionPrimitiveType;
  readonly shape?: Record<string, string | ProjectionFieldRuntimeSpec>;
  readonly nullable?: boolean;
  readonly optional?: boolean;
  readonly onNull?: ProjectionOnNull;
  readonly onMissing?: ProjectionOnMissing;
}

export interface ProjectionConstFieldRuntimeSpec {
  readonly const: ProjectionConstValue;
}

export type ProjectionFieldRuntimeSpec =
  | ProjectionPathFieldRuntimeSpec
  | ProjectionConstFieldRuntimeSpec;

export interface ProjectionUnionCaseRuntimeSpec {
  readonly shape: Record<string, string | ProjectionFieldRuntimeSpec>;
}

export interface ProjectionUnionRuntimeSpec {
  readonly discriminator: string;
  readonly onNoMatch?: ProjectionOnNoMatch;
  readonly cases: Record<string, ProjectionUnionCaseRuntimeSpec>;
}

export interface ProjectionRuntimeSpec {
  readonly from?: string;
  readonly shape?: Record<string, string | ProjectionFieldRuntimeSpec>;
  readonly union?: ProjectionUnionRuntimeSpec;
  readonly policy?: ProjectionPolicy;
}

export interface ProjectionHandle<T = unknown> {
  readonly kind: "projection";
  readonly id: string;
  readonly operationId: string;
  readonly __value?: T;
  readonly __runtime?: ProjectionRuntimeSpec;
}

export type ProjectionValue<T extends ProjectionHandle<any>> =
  T extends ProjectionHandle<infer TValue> ? TValue : never;

/**
 * Declare a slot.
 *
 * The returned object's JS reference is the slot's identity; use the same
 * reference (via `import` or closure) to wire producer and consumer sides
 * together. No arguments are accepted: slots have no author-facing name or
 * label. The runtime assigns an internal identifier automatically.
 */
export declare function slot<T = unknown>(): Slot<T>;

export declare function optional<S extends Slot<any, any>>(
  value: S,
): OptionalDependency<S>;

/**
 * Type-level: `by` is required iff `T` is a non-primitive object; forbidden
 * for primitives (grouping uses value equality directly).
 */
type AggregateBy<T> =
  T extends string | number | boolean | bigint | symbol | null | undefined
    ? { by?: never }
    : { by: keyof T & string };

type AggregateOptions<T> = AggregateBy<T> & {
  max?: number;
  missing?: "explode" | "skip";
};

/**
 * aggregate() marks an input as a row-aligned batch-map chunk. The grouping
 * key is specified per-call via `options.by` when the slot's value is an
 * object.
 *
 * The node's result/error handler must return exactly one entry per aggregate
 * input value. Count mismatches always fail. With `missing: "skip"`, an entry
 * may be `aggregate.SKIP` to emit no delta for that input index.
 *
 * Optional(...) is intentionally unsupported. Aggregate inputs must stay
 * row-aligned; optionality is an input binding concern, while `missing`
 * controls explicit missing output entries.
 */
export declare const aggregate: {
  <T, const TOpts extends AggregateOptions<T>>(
    value: Slot<T, any>,
    options: TOpts & ExactObject<AggregateOptions<T>, TOpts>,
  ): AggregateDependency<Slot<T, any>>;
  readonly SKIP: AggregateSkip;
};

/**
 * collect(slot) marks an output slot as mergeable when multiple sibling
 * branches produce the same top-level non-scalar value. The slot's type is
 * unchanged for downstream consumers. Without a custom merge, arrays append,
 * Sets union, Maps merge by key, and plain objects shallow-merge. Scalars are
 * not valid collect targets.
 */
export declare function collect<S extends Slot<object, any>>(
  value: S,
  options?: {
    readonly merge?: (accum: SlotValue<S>, item: SlotValue<S>) => void;
  },
): CollectOutput<S>;

export declare const scope: Scope;

/**
 * Low-level config reference primitive used by generated code and advanced internals.
 * Prefer generated connector config accessors from `config.generated.ts` in authored connectors.
 */
export declare function config<Name extends string = string>(
  name: Name,
): ConfigField<unknown, Name>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type UnionToIntersection<U> = (
  U extends unknown ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;
export type DependencyRef =
  | Slot<any, any>
  | OptionalDependency<Slot<any, any>>
  | AggregateDependency<Slot<any, any>>
  // `never` in the contravariant endpoint position makes this the most
  // permissive RequestArg in the `DependencyRef` lattice: any `RequestArg<T,
  // N, X>` is assignable to `RequestArg<T, N, never>` regardless of X. The
  // endpoint restriction kicks in at the endpoint *slot* types
  // (ResourceListEndpointSpec etc.), not at the generic DependencyRef.
  | RequestArg<any, any, never>;

type ResolveDependency<D> = D extends Slot<infer T, infer Name>
  ? Record<Name, T>
  : D extends OptionalDependency<Slot<infer T, infer Name>>
    ? Record<Name, T>
    : D extends AggregateDependency<Slot<infer T, infer Name>>
      ? Record<Name, T>
    : D extends RequestArg<infer T, infer Name, any>
      ? Record<Name, T>
      : never;
type ResolveFetchDependency<D> = D extends Slot<infer T, infer Name>
  ? Record<Name, T>
  : D extends OptionalDependency<Slot<infer T, infer Name>>
    ? Record<Name, T>
    : D extends AggregateDependency<Slot<infer T, infer Name>>
      ? Record<Name, readonly T[]>
      : D extends RequestArg<infer T, infer Name, any>
        ? Record<Name, T>
        : never;

type DependencyGroup = readonly DependencyRef[];
type DependencyShape = DependencyGroup | readonly DependencyGroup[];
type SupplyRef = Slot<any, any> | CollectOutput<Slot<any, any>>;
type SupplyGroup = readonly SupplyRef[];
type SupplyShape = SupplyGroup | readonly SupplyGroup[];

export type ResolveDependencyGroup<G extends DependencyGroup> = Simplify<
  UnionToIntersection<ResolveDependency<G[number]>>
>;
export type ResolveFetchDependencyGroup<G extends DependencyGroup> = Simplify<
  UnionToIntersection<ResolveFetchDependency<G[number]>>
>;

type BoundRecord<B> = B extends Slot<infer T, infer Name>
  ? Record<Name, T>
  : B extends CollectOutput<Slot<infer T, infer Name>>
    ? Record<Name, T>
  : never;

type ResolveBindings<B extends readonly Slot<any, any>[]> = Simplify<
  UnionToIntersection<BoundRecord<B[number]>>
>;

export type ResolveDependencyGroups<G extends DependencyShape> =
  G extends DependencyGroup
    ? ResolveDependencyGroup<G>
    : G extends readonly DependencyGroup[]
      ? Simplify<UnionToIntersection<ResolveDependencyGroup<G[number]>>>
      : never;
export type ResolveFetchDependencyGroups<G extends DependencyShape> =
  G extends DependencyGroup
    ? ResolveFetchDependencyGroup<G>
    : G extends readonly DependencyGroup[]
      ? Simplify<UnionToIntersection<ResolveFetchDependencyGroup<G[number]>>>
      : never;

export type ResolveSupplyGroup<G extends SupplyGroup> = ResolveBindings<G>;

export type ResolveSupplyGroups<G extends SupplyShape> =
  G extends SupplyGroup
    ? ResolveSupplyGroup<G>
    : G extends readonly SupplyGroup[]
      ? Simplify<UnionToIntersection<ResolveSupplyGroup<G[number]>>>
      : never;

export type ProducedSupplyGroups<G extends SupplyShape> =
  | ResolveSupplyGroups<G>
  | readonly ResolveSupplyGroups<G>[];

type NamedDependencyRef<Name extends string> =
  | Slot<any, Name>
  | OptionalDependency<Slot<any, Name>>
  | RequestArg<any, Name>;

type InputsObject<I extends Record<string, DependencyRef>> = {
  readonly [K in keyof I]: I[K];
};

export type ResolveDependencyObject<I extends Record<string, DependencyRef>> = {
  readonly [K in keyof I]:
    I[K] extends Slot<infer T, any>
      ? T
      : I[K] extends OptionalDependency<Slot<infer T, any>>
        ? T | undefined
        : I[K] extends AggregateDependency<Slot<infer T, any>>
          ? readonly T[]
        : I[K] extends RequestArg<infer T, any, any>
          ? T
          : never;
};

type OutputRef = Slot<any, any> | CollectOutput<Slot<any, any>>;

type OutputsObject<O extends Record<string, OutputRef>> = O;

export type ResolveOutputObject<O extends Record<string, OutputRef>> = {
  readonly [K in keyof O]:
    O[K] extends Slot<infer T, any>
      ? T
      : O[K] extends CollectOutput<Slot<infer T, any>>
        ? T
        : never;
};

export type AggregateProducedSupplyGroups<G extends SupplyShape> =
  readonly ProducedSupplyGroups<G>[];

export type WalkPaginationMode = "connector_page" | "all";

export interface WalkPagination {
  readonly mode?: WalkPaginationMode;
}

/**
 * A response/request JSON path that must address at least one segment. Empty
 * paths would silently read nothing (ending pagination after one page) or
 * write nowhere, so they are unrepresentable.
 */
export type PaginationPath = readonly [string, ...string[]];

/**
 * Node-level pagination contract, shared verbatim by the JS engine
 * (runtime/engine/bootstrap.ts) and the Go shaping host
 * (pkg/jsruntime/response_runtime.go). The discriminant is `kind`; each kind
 * requires the fields the engines actually read, so a typo or a missing
 * param is a compile error instead of a silently wrong request.
 */
interface PaginationSpecBase {
  /**
   * "all" collects every page inside the node before emitting; the default
   * pages through the connector-page loop one page at a time.
   */
  readonly mode?: WalkPaginationMode;
  /**
   * Hard cap on pages fetched by a pagination loop before the runtime fails
   * loudly instead of looping forever. Must be a positive integer; anything
   * else falls back to the default of 10000.
   *
   * Enforcement scope: the in-process pagination loops in both engines
   * (`mode: "all"` collection and fused sibling fetches) count pages
   * directly; the connector-page path persists the page count in the graph
   * page token so the cap also holds across connector calls. For the link
   * kind the cap is additionally forwarded to the Go HTTP transport, whose
   * page count rides in the serialized transport token.
   */
  readonly maxPages?: number;
}

/**
 * The Go transport owns the pagination loop via serialized transport tokens
 * (e.g. the SQL transport's offset token). The JS engine only threads the
 * opaque token through; no link fields apply.
 */
export interface TransportPaginationSpec extends PaginationSpecBase {
  readonly kind: "transport";
  readonly pageSize?: number;
  readonly pageSizeParam?: string;
  readonly pageParam?: never;
  readonly pageStart?: never;
  readonly linkRel?: never;
  readonly linkHeader?: never;
  readonly linkNextPath?: never;
}

/**
 * The Go transport follows RFC 5988 Link headers (or a JSON body path) to the
 * next page and owns the pagination loop.
 */
export interface LinkPaginationSpec extends PaginationSpecBase {
  readonly kind: "link";
  readonly pageSize?: number;
  readonly pageSizeParam?: string;
  readonly pageParam?: string;
  readonly pageStart?: number;
  /** Which Link rel to follow; the Go transport defaults to "next". */
  readonly linkRel?: string;
  /** Response header carrying the link (defaults to Link). */
  readonly linkHeader?: string;
  /** JSON body path holding the next URL, for APIs without a Link header. */
  readonly linkNextPath?: PaginationPath;
}

/** Send a token from the response body back as a query parameter. */
export interface ResponseTokenPaginationSpec extends PaginationSpecBase {
  readonly kind: "response_token";
  /** Query parameter the next request carries the token in. */
  readonly tokenParam: string;
  /** Response body path the token is read from. */
  readonly tokenPath: PaginationPath;
  /** Optional boolean gate; absent-or-false in the response ends pagination. */
  readonly hasNextPath?: PaginationPath;
  readonly pageSize?: number;
  readonly pageSizeParam?: string;
}

/**
 * Body-cursor pagination: the cursor is read from the response body at
 * `cursorPath` and written into the JSON request body at `bodyCursorPath`.
 * Both paths are required — without a write path the request would never
 * advance and the loop could never terminate.
 */
export interface CursorPaginationSpec extends PaginationSpecBase {
  readonly kind: "cursor";
  readonly cursorPath: PaginationPath;
  readonly bodyCursorPath: PaginationPath;
  /** Optional boolean gate; absent-or-false in the response ends pagination. */
  readonly hasNextPath?: PaginationPath;
}

/** Page-number pagination carried in a query parameter. */
interface PageNumberQueryPaginationFields extends PaginationSpecBase {
  readonly kind: "page_number";
  readonly pageParam: string;
  readonly pageBodyPath?: never;
  readonly pageSizeBodyPath?: never;
  readonly pageSize?: number;
  readonly pageSizeParam?: string;
  /**
   * First page number. Defaults to 1; an explicit 0 means a zero-based API
   * and is sent as page 0 (both the query and body variants honor 0).
   */
  readonly initialPage?: number;
  /** Response body path echoing the current page. */
  readonly pagePath?: PaginationPath;
  /** Response body path echoing the page size. */
  readonly maxResultsPath?: PaginationPath;
  /** Response body path carrying the total page count. */
  readonly totalPagesPath?: PaginationPath;
}

/** Page-number pagination written into the JSON request body (POST search APIs). */
interface PageNumberBodyPaginationFields extends PaginationSpecBase {
  readonly kind: "page_number";
  readonly pageBodyPath: PaginationPath;
  readonly pageParam?: never;
  readonly pageSizeParam?: never;
  readonly pageSizeBodyPath?: PaginationPath;
  readonly pageSize?: number;
  /**
   * First page number. Defaults to 1; an explicit 0 means a zero-based API
   * and is sent as page 0 (both the query and body variants honor 0).
   */
  readonly initialPage?: number;
  readonly maxResultsPath?: PaginationPath;
  readonly totalPagesPath?: PaginationPath;
}

/** Offset pagination carried in a query parameter. */
interface OffsetQueryPaginationFields extends PaginationSpecBase {
  readonly kind: "offset";
  readonly offsetParam: string;
  readonly offsetBodyPath?: never;
  readonly pageSizeBodyPath?: never;
  readonly pageSize?: number;
  readonly pageSizeParam?: string;
  readonly initialOffset?: number;
  /** Response body path echoing the current offset. */
  readonly startAtPath?: PaginationPath;
  readonly maxResultsPath?: PaginationPath;
  /** Response body path carrying the total item count. */
  readonly totalPath?: PaginationPath;
  /** Response body path carrying an is-last-page boolean. */
  readonly isLastPath?: PaginationPath;
}

/** Offset pagination written into the JSON request body (POST search APIs). */
interface OffsetBodyPaginationFields extends PaginationSpecBase {
  readonly kind: "offset";
  readonly offsetBodyPath: PaginationPath;
  readonly offsetParam?: never;
  readonly pageSizeParam?: never;
  readonly pageSizeBodyPath?: PaginationPath;
  readonly pageSize?: number;
  readonly initialOffset?: number;
  readonly maxResultsPath?: PaginationPath;
  readonly totalPath?: PaginationPath;
  readonly isLastPath?: PaginationPath;
}

/**
 * http.v1 (deprecated) keeps the lenient presets: the Go engine infers
 * termination and a short page ends the walk. `shortPage` is a v2 knob.
 */
type NoShortPage = { readonly shortPage?: never };
export type PageNumberQueryPaginationSpec = PageNumberQueryPaginationFields & NoShortPage;
export type PageNumberBodyPaginationSpec = PageNumberBodyPaginationFields & NoShortPage;
export type OffsetQueryPaginationSpec = OffsetQueryPaginationFields & NoShortPage;
export type OffsetBodyPaginationSpec = OffsetBodyPaginationFields & NoShortPage;

/**
 * http.v2 presets must say how they end. A termination field is the reliable
 * signal: `totalPagesPath` or row-count `totalPath` for page_number,
 * `totalPath` or `isLastPath` for offset. Without one the only signal is a
 * short page, which AWS, Google, Graph, and Okta document as unreliable,
 * so it is an explicit opt-in: `shortPage: true` says the API guarantees
 * full pages until the last, and needs `pageSize` or `maxResultsPath`.
 */
type ShortPageOptIn =
  | { readonly shortPage: true; readonly pageSize: number }
  | { readonly shortPage: true; readonly maxResultsPath: PaginationPath };
type PageNumberTerminationV2 =
  | { readonly totalPagesPath: PaginationPath; readonly totalPath?: never; readonly shortPage?: false }
  | ({ readonly totalPath: PaginationPath; readonly totalPagesPath?: never; readonly shortPage?: false } & OffsetPageSizeV2)
  | (ShortPageOptIn & { readonly totalPath?: never; readonly totalPagesPath?: never });
type OffsetPageSizeV2 =
  | { readonly pageSize: number }
  | { readonly maxResultsPath: PaginationPath };
type OffsetTerminationV2 =
  | { readonly totalPath: PaginationPath; readonly shortPage?: false }
  | { readonly isLastPath: PaginationPath; readonly shortPage?: false }
  | ShortPageOptIn;
export type PageNumberQueryPaginationSpecV2 = PageNumberQueryPaginationFields & PageNumberTerminationV2;
export type PageNumberBodyPaginationSpecV2 = PageNumberBodyPaginationFields & PageNumberTerminationV2;
export type OffsetQueryPaginationSpecV2 = OffsetQueryPaginationFields & OffsetTerminationV2 & OffsetPageSizeV2;
export type OffsetBodyPaginationSpecV2 = OffsetBodyPaginationFields & OffsetTerminationV2 & OffsetPageSizeV2;

/** Pagination on an http.v1 transport (deprecated surface; Go infers termination). */
export type PaginationSpecV1 =
  | TransportPaginationSpec
  | LinkPaginationSpec
  | ResponseTokenPaginationSpec
  | CursorPaginationSpec
  | PageNumberQueryPaginationSpec
  | PageNumberBodyPaginationSpec
  | OffsetQueryPaginationSpec
  | OffsetBodyPaginationSpec;

/**
 * Pagination on an http.v2 transport: presets that say how they end, or the
 * general form built with `page.program`. `kind: "transport"` is not a v2
 * kind (use `link` for transport-followed URLs).
 */
export type PaginationSpecV2 =
  | LinkPaginationSpec
  | ResponseTokenPaginationSpec
  | CursorPaginationSpec
  | PageNumberQueryPaginationSpecV2
  | PageNumberBodyPaginationSpecV2
  | OffsetQueryPaginationSpecV2
  | OffsetBodyPaginationSpecV2
  | AnyPaginationProgramSpec;

/**
 * Either version. Node-level `fetch` specs take a `via` of either version,
 * so they accept both; `http.v1(...)` and `http.v2(...)` request methods are
 * typed to their own version.
 */
export type PaginationSpec = PaginationSpecV1 | PaginationSpecV2;

/**
 * The union member for `page.program(...)` values. `next` takes `any` here
 * on purpose: the precise `selected` type lives on the value `page.program`
 * returns (inferred from its `select`), and a contravariant parameter in
 * the union member would reject every such value under strictFunctionTypes.
 */
export type AnyPaginationProgramSpec = Omit<PaginationProgramSpec<Record<string, PageSelector<any, boolean>>>, "next"> & {
  readonly next: (selected: any, token: string) => string | null;
};

// ---------------------------------------------------------------------------
// http.v2 pagination, general form: selectors in Go, decisions in JS.
//
// `select` names the values the decision needs; Go evaluates them against
// each response next to the body and hands JS a small typed record. `next`
// and `apply` are pure JS. The six kinds above are presets over the same
// three parts and keep working unchanged on http.v2.
// ---------------------------------------------------------------------------

export type PageSelectorType = "string" | "number" | "boolean";
type PageValueOf<T extends PageSelectorType> = T extends "string" ? string : T extends "number" ? number : boolean;

/**
 * One value to read from a response. `T` is what `next` receives; `Optional`
 * is whether absence is allowed (then `T | undefined`). Required is the
 * default: an absent, null, or empty required value fails the page naming
 * the selector, which is loud on page one; an optional one would feed
 * `undefined` into JS truthiness and loop or truncate silently.
 */
export interface PageSelector<T = unknown, Optional extends boolean = false> {
  readonly __batonPageSelector: true;
  readonly __value?: T;
  readonly __optional?: Optional;
}

export declare const page: {
  /**
   * A path into the body parsed per the request's `parseAs`. A string is one
   * key, never split (`"has_more"`, `"@odata.nextLink"`); a list is a nested
   * path (`["meta", "next"]`).
   */
  body<T extends PageSelectorType = "string">(path: string | readonly [string, ...string[]], type?: T): PageSelector<PageValueOf<T>>;
  header<T extends "string" | "number" = "string">(name: string, type?: T): PageSelector<PageValueOf<T>>;
  /** The Link header's URL for `rel` (default "next"); `header` names a non-standard header carrying links. */
  link(rel?: string, options?: { readonly header?: string }): PageSelector<string>;
  status(): PageSelector<number>;
  /** The unparsed body (for `parseAs: "text"`). */
  raw(): PageSelector<string>;
  /** Items on this page after `itemsPath`; never absent. */
  itemCount(): PageSelector<number>;
  /**
   * A field of the last item on this page (keyset pagination). Optional by
   * construction: an empty page has no last item and that is the normal
   * terminal state, so `selected.x` is `T | undefined` and required-ness
   * belongs on the gate (`has_more`), not here. A non-empty page whose last
   * item lacks the requested field is an error, not a terminal page.
   */
  lastItem<T extends PageSelectorType = "string">(path: string | readonly [string, ...string[]], type?: T): PageSelector<PageValueOf<T>, true>;
  /** Allow absence: absent, null, or "" yields `undefined` instead of failing the page. */
  optional<T>(selector: PageSelector<T, boolean>): PageSelector<T, true>;
  /**
   * The general form: selectors Go evaluates per response, and pure JS
   * `next`/`apply` over the selected record. See {@link PaginationProgramInput}.
   */
  program<const S extends Record<string, PageSelector<any, boolean>>>(spec: PaginationProgramInput<S>): PaginationProgramSpec<S>;

  /**
   * `apply` presets for the three ways a token is carried. Each returns an
   * `apply` function; the first page (empty token) sends the request as is.
   */
  toQuery(name: string): (request: PaginationRequest, token: string) => PaginationRequest;
  /** In the JSON body at `path` (a key, or a list of keys). */
  toBody(path: string | readonly string[]): (request: PaginationRequest, token: string) => PaginationRequest;
  /**
   * As the whole next URL (absolute, or relative to baseUrl), dropping the
   * first page's query so it is not re-applied on top. What `link` does.
   */
  toUrl(): (request: PaginationRequest, token: string) => PaginationRequest;
};

/** The record `next` receives: one property per selector, `| undefined` for optional ones. */
export type PageSelected<S extends Record<string, PageSelector<any, boolean>>> = {
  readonly [K in keyof S]: S[K] extends PageSelector<infer V, infer O> ? (O extends true ? V | undefined : V) : never;
};

/**
 * The request `apply` receives and returns: the materialized transport
 * request (`method`, `path`, `url?`, `query`, `params`, `headers`, `body`),
 * the same seven fields on every path; anything else on the wire request
 * is re-attached by the runtime after `apply`. `url` (absolute, or relative
 * to `baseUrl`) wins over `path`, which is how a next-URL scheme replays.
 */
export interface PaginationRequest {
  readonly method?: string;
  readonly path?: string;
  readonly url?: string;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly headers?: Record<string, unknown>;
  readonly body?: unknown;
}

/**
 * General-form pagination. `token` is the continuation this page was
 * fetched with: what the previous `next` returned, `""` on the first page,
 * and what the connector page token carries between process calls. `apply`
 * stamps it onto the request; `next` returns the token for the next page,
 * or `null` when done. The loop enforces: `next` returns `string | null`
 * (anything else, including `""` and `undefined`, is an error, not "done"),
 * never the same token again, and never more than `maxPages` pages.
 *
 *   pagination: page.program({
 *     select: { hasMore: page.body("has_more", "boolean"), last: page.lastItem("id") },
 *     next: (s) => (s.hasMore && s.last !== undefined ? s.last : null),
 *     apply: (req, t) => (t ? { ...req, query: { ...req.query, starting_after: t } } : req),
 *   })
 */
export interface PaginationProgramInput<S extends Record<string, PageSelector<any, boolean>>> extends PaginationSpecBase {
  readonly select: S;
  readonly next: (selected: PageSelected<S>, token: string) => string | null;
  readonly apply: (request: PaginationRequest, token: string) => PaginationRequest;
}

/**
 * The value `page.program(...)` returns. Branded so the general form is
 * always built through `page.program`, which is what gives `next` its exact
 * `selected` type: the request helpers infer their whole spec as one type
 * parameter, which leaves an inline callback contextually untyped. The
 * brand is a non-exported unique symbol, so a hand-written literal cannot
 * forge it; the runtime marker `__batonPaginationProgram` rides alongside
 * for the engine.
 */
declare const paginationProgramBrand: unique symbol;
export interface PaginationProgramSpec<S extends Record<string, PageSelector<any, boolean>>> extends PaginationProgramInput<S> {
  readonly [paginationProgramBrand]: true;
  readonly __batonPaginationProgram: true;
  readonly kind?: undefined;
}

/**
 * SQL pagination is transport-managed: the Go SQL transport appends
 * LIMIT/OFFSET (or OFFSET...FETCH) to the query and owns the next-page
 * token. Two hard requirements, both enforced loudly at runtime:
 *
 * - The authored query must include an ORDER BY on a stable key — SQL
 *   guarantees no row order without one, so unordered paging can duplicate
 *   or skip rows between requests.
 * - The authored query must not contain its own LIMIT/OFFSET clause; the
 *   transport cannot rewrite it and would re-read the same rows forever.
 */
export interface SqlPaginationSpec extends PaginationSpecBase {
  readonly kind: "offset";
  /** Rows per page; must be a positive integer. */
  readonly pageSize: number;
}

type AnyOperationHandle = OperationHandle<unknown, unknown, unknown>;
export type OperationRequestOf<O extends AnyOperationHandle> =
  O extends OperationHandle<unknown, unknown, infer TRequest> ? TRequest : never;

export type OperationTransportRequestOf<O extends AnyOperationHandle> =
  O extends OperationHandle<infer TRequest, unknown, unknown> ? TRequest : never;

export type OperationResponseOf<O extends AnyOperationHandle> =
  O extends OperationHandle<unknown, infer TResponse, unknown> ? TResponse : never;

export interface HttpExecution<TResponse = unknown> {
  readonly __batonExecutionKind: "http";
  readonly via: Transport;
  readonly operation?: AnyOperationHandle;
  readonly projection?: ProjectionHandle<any>;
  readonly request: unknown;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | false;
  readonly __response?: TResponse;
}

export interface SqlExecution<TResponse = unknown> {
  readonly __batonExecutionKind: "sql";
  readonly via: Transport;
  readonly request: unknown;
  readonly pagination?: SqlPaginationSpec;
  readonly __response?: TResponse;
}

export type Execution<TResponse = unknown> =
  | HttpExecution<TResponse>
  | SqlExecution<TResponse>;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/**
 * How the transport parses a response body before `itemsPath`, projections,
 * and pagination read it. A property of the response, so it sits on the
 * request next to `itemsPath`, not on the transport and not on each reader.
 * "json" (the default; a body that is not JSON is an error on http.v2, not
 * an empty page), "xml" (lowered to the same tree: namespace prefixes are
 * dropped, attributes are "-name", mixed text is "#text"), or "text" (no
 * tree; the body is exposed as `_raw`).
 */
export type HttpParseAs = "json" | "xml" | "text";

type RawHttpExecutionSpecBase<Method extends string> = {
  readonly path: string;
  readonly query?: Record<string, unknown>;
  readonly headers?: Record<string, unknown>;
  readonly body?: unknown;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly method?: Method;
};

/** Per-request policy overrides on http.v1: the transport's snake_case names. */
type HttpRequestPolicyV1 = {
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | false;
};

/**
 * Per-request policy overrides on http.v2. `retry: false` disables retries
 * for this call; an object overrides the transport's policy for this call.
 */
type HttpRequestPolicyV2 = {
  readonly failureClassifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfigV2 | false;
};

type RawHttpExecutionSpecOf<Method extends string, Pagination, Policy> =
  RawHttpExecutionSpecBase<Method> & { readonly pagination?: Pagination } & Policy;

/** @deprecated http.v1 request shape; see {@link RawHttpExecutionSpecV2}. */
export type RawHttpExecutionSpec<Method extends string = string> =
  RawHttpExecutionSpecOf<Method, PaginationSpecV1, HttpRequestPolicyV1>;
/** The argument of `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD` on an http.v2 transport. */
export type RawHttpExecutionSpecV2<Method extends string = string> =
  RawHttpExecutionSpecOf<Method, PaginationSpecV2, HttpRequestPolicyV2>;

type OperationRequestShapeOf<O> = (
  O extends { readonly types: { readonly request: infer TRequest } }
    ? TRequest
    : O extends AnyOperationHandle
      ? OperationRequestOf<O>
      : never
);

export type OperationInvocationSpec<
  O,
  P extends ProjectionHandle<any> | undefined = undefined,
> = Simplify<OperationRequestShapeOf<O> & {
  readonly projection?: P;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
}>;

type OperationRequestPortion<T> =
  T extends object ? Omit<T, "projection" | "itemsPath" | "pagination" | "parseAs" | "retry" | "failureClassifier" | "failure_classifier"> : never;

/**
 * Exact-checks an inferred spec's pagination member against the
 * PaginationSpec union. The generic authoring surfaces (http.GET/POST/...,
 * http.request) infer the whole spec literal as TActual, which bypasses
 * excess-property checking on nested members — a typo'd pagination field
 * (`pageSze`) would compile and be silently ignored at runtime. Intersecting
 * the parameter with this helper restores per-field exactness for the
 * pagination member without disturbing inference of the rest of the spec.
 *
 * The second branch handles specs whose inferred pagination member is
 * OPTIONAL (e.g. built with a conditional spread): without it those fell
 * through to plain assignability and a typo'd field compiled again.
 */
type ExactPaginationField<TActual, Pagination = PaginationSpec> =
  TActual extends { readonly pagination: infer P }
    ? { readonly pagination: ExactReturn<Pagination, P> }
    : TActual extends { readonly pagination?: infer P }
      ? { readonly pagination?: ExactReturn<Pagination, NonNullable<P>> }
      : { readonly pagination?: Pagination };

/**
 * Exact-checks the pagination member of a SQL query spec against
 * SqlPaginationSpec, mirroring ExactPaginationField for the HTTP surfaces:
 * sql.query infers the whole spec generically, so without this a pagination
 * object passed through a variable could smuggle extra members (offsetParam,
 * pageSze, ...) that the SQL transport silently ignores.
 */
type ExactSqlPaginationField<TActual> =
  TActual extends { readonly pagination: infer P }
    ? { readonly pagination: ExactReturn<SqlPaginationSpec, P> }
    : TActual extends { readonly pagination?: infer P }
      ? { readonly pagination?: ExactReturn<SqlPaginationSpec, NonNullable<P>> }
      : { readonly pagination?: SqlPaginationSpec };

/**
 * Rejects top-level keys that are not part of the expected spec shape.
 * The raw HTTP helpers infer TActual from the argument, so plain
 * excess-property checking never fires and a top-level typo (`pagintion`)
 * would compile — and be silently ignored at runtime, quietly disabling
 * pagination. Extra keys map to `never`, which no provided value satisfies.
 */
type NoExcessTopLevelKeys<TExpected, TActual> = {
  readonly [K in Exclude<keyof TActual, keyof TExpected>]: never;
};

/**
 * The request methods of an HTTP transport handle, typed to the version's
 * pagination union and per-request policy spelling. `http.v1` returns
 * {@link HttpTransport}, `http.v2` returns {@link HttpTransportV2}.
 */
interface HttpTransportSurface<Pagination, Policy> extends Transport {
  request<
    O extends { readonly types: { readonly request: unknown } },
    P extends ProjectionHandle<any>,
    TActual,
  >(
    operation: O,
    spec: Policy & {
      readonly projection: P;
      readonly itemsPath?: readonly string[];
      readonly parseAs?: HttpParseAs;
      readonly pagination?: Pagination;
    } & TActual & ExactReturn<O["types"]["request"], OperationRequestPortion<TActual>> & ExactPaginationField<TActual, Pagination>,
  ): HttpExecution<ProjectionValue<P>>;
  request<
    O extends { readonly types: { readonly request: unknown } },
    TActual,
  >(
    operation: O,
    spec: Policy & TActual & {
      readonly itemsPath?: readonly string[];
      readonly parseAs?: HttpParseAs;
      readonly pagination?: Pagination;
    } & ExactReturn<O["types"]["request"], OperationRequestPortion<TActual>> & ExactPaginationField<TActual, Pagination>,
  ): HttpExecution<unknown>;
  request<
    O extends AnyOperationHandle,
    P extends ProjectionHandle<any>,
    TActual,
  >(
    operation: O,
    spec: Policy & TActual & {
      readonly projection: P;
      readonly itemsPath?: readonly string[];
      readonly parseAs?: HttpParseAs;
      readonly pagination?: Pagination;
    } & ExactReturn<OperationRequestOf<O>, OperationRequestPortion<TActual>> & ExactPaginationField<TActual, Pagination>,
  ): HttpExecution<ProjectionValue<P>>;
  request<
    O extends AnyOperationHandle,
    TActual,
  >(
    operation: O,
    spec: Policy & TActual & {
      readonly itemsPath?: readonly string[];
      readonly parseAs?: HttpParseAs;
      readonly pagination?: Pagination;
    } & ExactReturn<OperationRequestOf<O>, OperationRequestPortion<TActual>> & ExactPaginationField<TActual, Pagination>,
  ): HttpExecution<OperationResponseOf<O>>;
  GET<TActual extends RawHttpExecutionSpecOf<"GET", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"GET", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
  POST<TActual extends RawHttpExecutionSpecOf<"POST", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"POST", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
  PUT<TActual extends RawHttpExecutionSpecOf<"PUT", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"PUT", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
  PATCH<TActual extends RawHttpExecutionSpecOf<"PATCH", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"PATCH", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
  DELETE<TActual extends RawHttpExecutionSpecOf<"DELETE", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"DELETE", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
  HEAD<TActual extends RawHttpExecutionSpecOf<"HEAD", Pagination, Policy>>(
    spec: TActual & ExactPaginationField<TActual, Pagination> & NoExcessTopLevelKeys<RawHttpExecutionSpecOf<"HEAD", Pagination, Policy>, TActual>,
  ): HttpExecution<unknown>;
}

/** @deprecated The handle returned by `http.v1(...)`; author against {@link HttpTransportV2}. */
export interface HttpTransport extends HttpTransportSurface<PaginationSpecV1, HttpRequestPolicyV1> {}

export interface HttpTransportV2 extends HttpTransportSurface<PaginationSpecV2, HttpRequestPolicyV2> {}

type ExactObject<TExpected, TActual> =
  // Keep expected and extra keys separate. The simpler
  // `TActual extends TExpected ? ... : never` version preserved assignability,
  // but it pushed operation request errors out to enclosing overloads and made
  // extra nested keys much easier to miss in real connector code.
  Simplify<{
    [K in Exclude<keyof TExpected, OptionalKeys<TExpected>>]:
      K extends keyof TActual
        ? ExactSection<TExpected[K], TActual[K]>
        : never;
  } & {
    [K in OptionalKeys<TExpected>]?: K extends keyof TActual
      ? ExactSection<TExpected[K], TActual[K]>
      : TExpected[K];
  } & {
    [K in Exclude<keyof TActual, keyof TExpected>]: never;
  }>;

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type ExactSection<TExpected, TActual> =
  TExpected extends readonly unknown[]
    ? TActual extends TExpected ? TActual : never
    // Function types and tagged Walk shapes must be checked via ordinary
    // assignability so return-type variance on `to` is honored, rather than
    // being destructured into their synthetic members.
    //
    // INVARIANT: `Walk<...>` must always include `readonly kind: "walk"`
    // as a literal discriminant. If that field is ever renamed or removed,
    // this branch silently falls through to the generic object case and
    // `ExactObject` destructures the Walk, which breaks contravariance on
    // `to`'s return type and silently allows grant walkers into resource
    // slots. Update this branch in lockstep with any change to Walk's tag.
    : TExpected extends (...args: any) => any
      ? TActual extends TExpected ? TActual : never
    : TExpected extends { readonly kind: "walk" }
      ? TActual extends TExpected ? TActual : never
    // page.program values are branded and already exact (the builder's
    // own parameter type rejects extra keys); destructuring them would
    // re-check `next` against the loose union member.
    : TExpected extends { readonly [paginationProgramBrand]: true }
      ? TActual extends TExpected ? TActual : never
    : TExpected extends object
      ? string extends keyof TExpected
        ? TActual extends TExpected ? TActual : never
        : number extends keyof TExpected
          ? TActual extends TExpected ? TActual : never
          : ExactObject<TExpected, TActual>
      : TActual extends TExpected ? TActual : never;

type ExactReturn<TExpected, TActual> =
  TActual extends ExactSection<TExpected, TActual> ? TActual : never;

type RequestBuilder<TRow, TExpected, TActual> =
  (dependencies: TRow) => ExactReturn<TExpected, TActual>;

type OperationFetchResponse<
  O extends AnyOperationHandle,
  P extends ProjectionHandle<any> | undefined,
> = P extends ProjectionHandle<any>
  ? ProjectionValue<NonNullable<P>>
  : OperationResponseOf<O>;

interface NodeFetchWithoutOperation<TRow, TValue = unknown> {
  readonly via: Transport;
  readonly operation?: undefined;
  readonly projection?: ProjectionHandle<TValue>;
  readonly request: (dependencies: TRow) => RawHttpRequest;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
}

export interface OperationFetchSpec<
  TRow,
  O extends AnyOperationHandle,
  P extends ProjectionHandle<any> | undefined = undefined,
  TRequest = OperationRequestOf<O>,
> {
  readonly via: Transport;
  readonly operation: O;
  readonly projection?: P;
  readonly request: RequestBuilder<TRow, OperationRequestOf<O>, TRequest>;
  readonly path?: never;
  readonly query?: never;
  readonly headers?: never;
  readonly body?: never;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
  readonly __input?: TRow;
  readonly __response?: OperationFetchResponse<O, P>;
}

type AnyOperationFetch<TRow = any> = OperationFetchSpec<
  TRow,
  AnyOperationHandle,
  ProjectionHandle<any> | undefined,
  any
>;

type AnyNodeFetch<TRow, TValue = unknown> =
  | NodeFetchWithoutOperation<TRow, TValue>
  | AnyOperationFetch<TRow>;

type NonOperationFetchLike<TRow, TValue = unknown> =
  | NodeFetchWithoutOperation<TRow, TValue>
  | OperationModule<TRow, AnyOperationHandle, TValue>;

type LoadedValueOfFetch<F> =
  F extends OperationModule<any, AnyOperationHandle, infer TResponse>
    ? TResponse
    : F extends OperationFetchSpec<
          any,
          infer O extends AnyOperationHandle,
          infer P extends ProjectionHandle<any> | undefined,
          any
        >
      ? OperationFetchResponse<O, P>
    : F extends { projection: ProjectionHandle<infer T>; itemsPath: readonly string[] }
    ? unknown
    : F extends { projection: ProjectionHandle<infer T> }
      ? T
      : unknown;

declare const operationModuleBrand: unique symbol;

export interface OperationModule<
  TRow,
  O extends AnyOperationHandle,
  TResponse = unknown,
> {
  readonly via: Transport;
  readonly operation: O;
  readonly projection?: ProjectionHandle<any>;
  readonly request: (dependencies: TRow) => OperationTransportRequestOf<O>;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly failureClassifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | RetryConfigV2 | false;
  readonly __input?: TRow;
  readonly __response?: TResponse;
  readonly [operationModuleBrand]: true;
}

export interface GeneratedOperationSpec<
  TRow,
  O extends AnyOperationHandle,
  P extends ProjectionHandle<any> | undefined = undefined,
  TRequest = OperationRequestOf<O>,
> {
  readonly via: Transport;
  readonly projection?: P;
  readonly request: RequestBuilder<TRow, OperationRequestOf<O>, TRequest>;
  readonly itemsPath?: readonly string[];
  readonly parseAs?: HttpParseAs;
  readonly pagination?: PaginationSpec;
  /** v1 spelling; on a v2 `via` write `failureClassifier`. */
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly failureClassifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | RetryConfigV2 | false;
}

export interface GeneratedOperation<O extends AnyOperationHandle>
  extends OperationHandle<
    OperationTransportRequestOf<O>,
    OperationResponseOf<O>,
    OperationRequestOf<O>
  > {
  <
    TRow,
    P extends ProjectionHandle<any> | undefined = undefined,
    TRequest = OperationRequestOf<O>,
  >(
    spec: GeneratedOperationSpec<TRow, O, P, TRequest>,
  ): OperationModule<
    TRow,
    O,
    P extends ProjectionHandle<any> ? ProjectionValue<NonNullable<P>> : unknown
  >;
}

type AnyOperationModule = OperationModule<any, AnyOperationHandle, any>;
type AnyOperationRun<TRow = any> =
  | AnyOperationFetch<TRow>
  | OperationModule<TRow, AnyOperationHandle, any>;

export type RunInputOf<M> =
  M extends unknown
    ? M extends OperationFetchSpec<any, any, any, any>
      ? M extends OperationFetchSpec<infer TInput, any, any, any> ? TInput : never
      : M extends OperationModule<infer TInput, AnyOperationHandle, any>
      ? TInput
      : M extends Record<string, AnyOperationRun<any>>
        ? Simplify<UnionToIntersection<RunInputOf<M[keyof M]>>>
        : never
    : never;

export type RunResponseOf<M> =
  M extends unknown
    ? M extends OperationFetchSpec<
        any,
        infer O extends AnyOperationHandle,
        infer P extends ProjectionHandle<any> | undefined,
        any
      >
      ? OperationFetchResponse<O, P>
      : M extends OperationModule<any, AnyOperationHandle, infer TResponse>
      ? TResponse
      : M extends Record<string, AnyOperationRun<any>>
        ? { readonly [K in keyof M]: RunResponseOf<M[K]> }
        : never
    : never;

export type ParallelRunModules<T extends Record<string, AnyOperationRun<any>>> = {
  readonly [K in keyof T]: T[K];
};

export type AnyRunModule<TRow = any> =
  | AnyOperationRun<TRow>
  | ParallelRunModules<Record<string, AnyOperationRun<TRow>>>;

// CacheScope is generated from pkg/jsconnector. The re-export keeps
// the @baton/runtime module surface stable while forwarding to the
// ambient CacheRuntime namespace declared in
// runtime/engine/cache-scope.generated.ts so the Go constants stay
// the single source of truth for connector-authoring and for runtime.
export type CacheScope = CacheRuntime.CacheScope;
export type MemoScope = CacheScope;

export interface ActionExecutionPolicy {
  // Caps concurrent load executions for this action.
  readonly maxParallelism?: number;
}

export interface ActionMemoPolicy<TInputs extends Record<string, unknown>> {
  // `memo` stores normalized produced delta rows, not raw responses.
  readonly scope: readonly MemoScope[];
  readonly key: (inputs: TInputs) => string;
}

export type ValidationRuleLevel = "off" | "warn" | "error";

export interface ValidationIgnoreRule {
  readonly rule: string;
  readonly reason?: string;
}

export type ValidationIgnoreEntry = string | ValidationIgnoreRule;

export interface ValidationDirective {
  readonly ignore?: readonly ValidationIgnoreEntry[];
  readonly rules?: Readonly<Record<string, ValidationRuleLevel>>;
}

interface NodeBaseSpec<TRow extends Record<string, unknown>> extends Record<string, unknown> {
  readonly name: string;
  readonly when?: (dependencies: TRow) => boolean;
  readonly execution?: ActionExecutionPolicy;
  readonly memo?: ActionMemoPolicy<TRow>;
  readonly lint?: ValidationDirective;
}

export interface FailureClassifierRule {
  readonly name?: string;
  readonly match: string;
  readonly result: {
    readonly class: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface FailureClassifierConfig {
  readonly rules: readonly FailureClassifierRule[];
}

/**
 * Retry policy for a transport call. Retry decisions are class-driven: the
 * `retryable_classes` list is the canonical axis. To retry a specific HTTP
 * status (or other transport signal), add a `failure_classifier` rule that
 * maps it to one of the canonical {@link ErrorClass} values such as
 * `"transient"`.
 *
 * A `"rate_limited"` failure (a 429 under the default classifier) is not
 * retried in-connector by this policy: it is surfaced to the caller as gRPC
 * `Unavailable` carrying a `RateLimitDescription`, and baton-sdk's retryer owns
 * the backoff outside the connector's wall-clock budget. Listing
 * `"rate_limited"` in `retryable_classes` therefore has no in-connector effect.
 * (This is about the connector-declared policy; an operator `connect.retry`
 * overlay is a separate axis.)
 *
 * This applies to every entrypoint, provisioning included: a rate-limited write
 * is surfaced to the caller too, and baton-sdk may replay the whole entrypoint
 * (`provisioning.grant` / `revoke` / `createAccount` / `rotateCredential`), so
 * provisioning code must tolerate a caller-side retry.
 *
 * Note that `err.retryable` stays `true` for a `"rate_limited"` error (it
 * remains a retryable class, e.g. in the default retryable set). Do not branch
 * on `err.retryable` to predict whether the connector will retry — rate limits
 * are always handed to the caller.
 */
export interface RetryConfig {
  readonly max_retries?: number;
  readonly retry_interval?: string;
  readonly retry_multiplier?: number;
  /**
   * Upper bound on a retry delay. For classes that are still retried
   * in-connector this also caps a server `Retry-After`: a `transient` failure
   * carrying `Retry-After: 300` waits at most this long (30s default) rather
   * than honoring the server exactly. Raise it if you need to follow longer
   * server-directed backoff within the connector's budget.
   */
  readonly max_retry_interval?: string;
  readonly retryable_classes?: readonly string[];
}

/**
 * Retry policy on http.v2, camelCase like the rest of that surface.
 * Defaults: 3 retries, 1s base interval, x2 multiplier, 30s cap, and the
 * runtime's default retryable classes. When `retryableClasses` is set it is
 * the sole axis: an error is retried only if its class is listed.
 * Rate-limited failures are always handed to the caller for backoff outside
 * the connector's wall-clock budget, even when listed in retryableClasses.
 * See {@link RetryConfig} for caller-side replay and Retry-After semantics.
 *
 * Conditional `rules` from the Go retry engine are intentionally not part of
 * this DSL. Use failureClassifier to classify failures, then configure their
 * retryable classes, retry limit, and backoff here. Untyped `rules` objects
 * are rejected rather than passed through to the Go engine.
 */
export interface RetryConfigV2 {
  readonly maxRetries?: number;
  readonly retryInterval?: string;
  readonly retryMultiplier?: number;
  readonly maxRetryInterval?: string;
  readonly retryableClasses?: readonly string[];
}

export interface SourceNodeSpec<
  A extends SupplyShape,
  F extends NonOperationFetchLike<Record<never, never>, any> = NonOperationFetchLike<Record<never, never>>,
> extends NodeBaseSpec<Record<never, never>> {
  readonly requires?: undefined;
  readonly supplies: A;
  readonly fetch: F;
  readonly bind: (fetchedValue: LoadedValueOfFetch<F>) => ProducedSupplyGroups<A>;
}

export interface SourceNodeOperationSpec<
  A extends SupplyShape,
  O extends AnyOperationHandle,
  P extends ProjectionHandle<any> | undefined = undefined,
  TRequest = OperationRequestOf<O>,
> extends NodeBaseSpec<Record<never, never>> {
  readonly requires?: undefined;
  readonly supplies: A;
  readonly fetch: OperationFetchSpec<Record<never, never>, O, P, TRequest>;
  readonly bind: (
    fetchedValue: OperationFetchResponse<O, P>,
  ) => ProducedSupplyGroups<A>;
}

export interface SourceNodeObjectRunSpec<
  O extends Record<string, OutputRef>,
  M extends AnyRunModule<Record<never, never>>,
> extends NodeBaseSpec<Record<never, never>> {
  readonly inputs?: never;
  readonly outputs: OutputsObject<O>;
  readonly run: M & (Record<never, never> extends RunInputOf<M> ? unknown : never);
  readonly result: (
    args: { readonly response: RunResponseOf<M> },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}

export interface DependentNodeSpec<
  R extends DependencyShape,
  A extends SupplyShape,
  F extends NonOperationFetchLike<ResolveFetchDependencyGroups<R>, any> = NonOperationFetchLike<ResolveFetchDependencyGroups<R>>,
> extends NodeBaseSpec<ResolveDependencyGroups<R>> {
  readonly requires: R;
  readonly supplies: A;
  readonly fetch: F;
  readonly bind: (
    dependencies: ResolveFetchDependencyGroups<R>,
    fetchedValue: LoadedValueOfFetch<F>,
  ) => ProducedSupplyGroups<A> | AggregateProducedSupplyGroups<A>;
}

export interface DependentNodeOperationSpec<
  R extends DependencyShape,
  A extends SupplyShape,
  O extends AnyOperationHandle,
  P extends ProjectionHandle<any> | undefined = undefined,
  TRequest = OperationRequestOf<O>,
> extends NodeBaseSpec<ResolveDependencyGroups<R>> {
  readonly requires: R;
  readonly supplies: A;
  readonly fetch: OperationFetchSpec<ResolveDependencyGroups<R>, O, P, TRequest>;
  readonly bind: (
    dependencies: ResolveDependencyGroups<R>,
    fetchedValue: OperationFetchResponse<O, P>,
  ) => ProducedSupplyGroups<A>;
}

export interface DependentNodeObjectRunSpec<
  I extends Record<string, DependencyRef>,
  O extends Record<string, OutputRef>,
  M extends AnyRunModule<ResolveDependencyObject<I>>,
> extends NodeBaseSpec<ResolveDependencyObject<I>> {
  readonly inputs: InputsObject<I>;
  readonly outputs: OutputsObject<O>;
  readonly run: M & (ResolveDependencyObject<I> extends RunInputOf<M> ? unknown : never);
  readonly result: (
    args: ResolveDependencyObject<I> & {
      readonly response: RunResponseOf<M>;
    },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}

export type ActionRunFunction<TInputs extends Record<string, unknown>, TResponse = unknown> = (
  inputs: TInputs,
) => Execution<TResponse>;

export type ActionRunShape<TInputs extends Record<string, unknown>> =
  | ActionRunFunction<TInputs, any>
  | { readonly [K: string]: ActionRunFunction<TInputs, any> };

export type ActionResponseOf<R> =
  R extends ActionRunFunction<any, infer TResponse>
    ? TResponse
    : R extends Record<string, ActionRunFunction<any, any>>
      ? { readonly [K in keyof R]: ActionResponseOf<R[K]> }
      : never;

type LiftActionRunShape<
  TInputs extends Record<string, unknown>,
  R extends ActionRunShape<any>,
> =
  R extends ActionRunFunction<any, infer TResponse>
    ? ActionRunFunction<TInputs, TResponse>
    : { readonly [K in keyof R]:
        R[K] extends ActionRunFunction<any, infer TResponse>
          ? ActionRunFunction<TInputs, TResponse>
          : never;
      };

type ReuseInputObject = Record<string, Slot<any, any>>;
type ResolveReuseInputObject<I extends ReuseInputObject> = {
  readonly [K in keyof I]: I[K] extends Slot<infer T, any> ? T : never;
};

/**
 * Cache configuration for a reuse block.
 *
 * `key` is required: the runtime no longer falls back to a whole-row hash,
 * which means cache identity is purely a function of `namespace + scope + key(inputs)`.
 *
 * The runtime also enforces a namespace collision registry - two reuse blocks
 * declaring the same `namespace` with different `scope` arrays throw at load
 * time.
 */
export interface ReuseCacheSpec<
  I extends ReuseInputObject,
> {
  readonly namespace: string;
  readonly scope: readonly CacheScope[];
  readonly key: (inputs: ResolveReuseInputObject<I>) => string | number | boolean;
}

interface ReuseUseBaseSpec<
  I extends Record<string, DependencyRef>,
  RI extends ReuseInputObject,
> {
  readonly name?: string;
  readonly inputs: InputsObject<I>;
  readonly args: (dependencies: ResolveDependencyObject<I>) => ResolveReuseInputObject<RI>;
  readonly when?: (dependencies: ResolveDependencyObject<I>) => boolean;
  readonly execution?: ActionExecutionPolicy;
  readonly lint?: ValidationDirective;
}

interface ReuseUseDerivedSpec<
  I extends Record<string, DependencyRef>,
  RI extends ReuseInputObject,
  R extends ActionRunShape<ResolveReuseInputObject<RI>>,
  O extends Record<string, OutputRef>,
> extends ReuseUseBaseSpec<I, RI> {
  readonly outputs: OutputsObject<O>;
  readonly result: (
    args: ResolveDependencyObject<I> & ResolveReuseInputObject<RI> & {
      readonly response: ActionResponseOf<R>;
    },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}

/**
 * Compile-time branded type returned by `reuse.use(...)` when the use-site
 * inputs contain an `AggregateDependency`. Prevents an aggregate-consuming
 * action from being wired to a cached reuse block (the runtime does not
 * support combining these).
 */
export interface InvalidAction<Reason extends string> {
  readonly __invalidAction: Reason;
}

type HasAggregateInput<I extends Record<string, DependencyRef>> =
  {
    readonly [K in keyof I]:
      I[K] extends AggregateDependency<any> ? true : never;
  }[keyof I] extends never
    ? false
    : true;

type GuardAggregateUseSite<
  I extends Record<string, DependencyRef>,
  R,
> = HasAggregateInput<I> extends true
  ? InvalidAction<"aggregate inputs are not supported with a cached reuse">
  : R;

export interface ReuseDefinitionWithOutputs<
  RI extends ReuseInputObject,
  O extends Record<string, OutputRef>,
  R extends ActionRunShape<ResolveReuseInputObject<RI>>,
> {
  readonly inputs: RI;
  readonly cache?: ReuseCacheSpec<RI>;
  use<const I extends Record<string, DependencyRef>>(
    spec: ReuseUseBaseSpec<I, RI>,
  ): GuardAggregateUseSite<
    I,
    ActionSpec<I, O, LiftActionRunShape<ResolveDependencyObject<I>, R>>
  >;
}

export interface ReuseDefinitionWithoutOutputs<
  RI extends ReuseInputObject,
  R extends ActionRunShape<ResolveReuseInputObject<RI>>,
> {
  readonly inputs: RI;
  readonly cache?: ReuseCacheSpec<RI>;
  use<
    const I extends Record<string, DependencyRef>,
    const O extends Record<string, OutputRef>,
  >(
    spec: ReuseUseDerivedSpec<I, RI, R, O>,
  ): GuardAggregateUseSite<
    I,
    ActionSpec<I, O, LiftActionRunShape<ResolveDependencyObject<I>, R>>
  >;
}

export interface ActionSpec<
  I extends Record<string, DependencyRef>,
  O extends Record<string, OutputRef>,
  R extends ActionRunShape<ResolveDependencyObject<I>>,
> extends NodeBaseSpec<ResolveDependencyObject<I>>,
  NodeLike<NodeEndpointsFor<I>> {
  readonly name?: string;
  readonly inputs: InputsObject<I>;
  readonly requires?: readonly DependencyRef[];
  readonly outputs: OutputsObject<O>;
  readonly run: R;
  readonly result: (
    args: ResolveDependencyObject<I> & {
      readonly response: ActionResponseOf<R>;
    },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly error?: (
    args: ResolveDependencyObject<I> & {
      readonly error: unknown;
    },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}

export interface SourceActionSpec<
  O extends Record<string, OutputRef>,
  R extends ActionRunShape<Record<never, never>>,
> extends NodeBaseSpec<Record<never, never>>,
  NodeLike<EndpointKind> {
  readonly name?: string;
  readonly inputs?: never;
  readonly outputs: OutputsObject<O>;
  readonly run: R;
  readonly result: (
    args: { readonly response: ActionResponseOf<R> },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly error?: (
    args: { readonly error: unknown },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}

export type SDKActionFieldType =
  | "string"
  | "bool"
  | "int"
  | "string_slice"
  | "string_map"
  | "resource_id"
  | "object";

export interface SDKActionFieldSpec<
  TType extends SDKActionFieldType = SDKActionFieldType,
> {
  readonly name: string;
  readonly propertyName: string;
  readonly type: TType;
  readonly required?: boolean;
  readonly displayName?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly resourceTypes?: readonly string[];
}

interface ActionLike {
  readonly kind?: "action" | "source" | "reuse";
  readonly name?: string;
}

/**
 * Union of endpoint tags carried by every `RequestArg` in an input record.
 * Slots and their wrappers contribute nothing. This is the raw union; see
 * {@link NodeEndpointsFor} for the intersection that determines where a
 * node can actually be used.
 */
type InputInTags<I> = {
  readonly [K in keyof I]: I[K] extends RequestArg<any, any, infer In> ? In : never;
}[keyof I];

/**
 * The endpoints a node can run in, derived from its `inputs`. If the node
 * only consumes `Slot`s (no ambient `RequestArg`s), the result is
 * `EndpointKind` — the node is runnable anywhere. If the node consumes
 * ambient `RequestArg`s, the result is the union of every input
 * `RequestArg`'s endpoint tag: every endpoint that at least one input is
 * provided in. In practice, multi-input nodes in this codebase share one
 * tag (e.g. both inputs tagged `"grant"`), so the union and intersection
 * agree; if a future node has inputs with disjoint tags it should be
 * expressed as two nodes instead.
 */
type NodeEndpointsFor<I> =
  [InputInTags<I>] extends [never]
    ? EndpointKind
    : InputInTags<I>;

/**
 * Node-in-a-walker marker. A walker's `nodes: readonly NodeLike<E>[]`
 * requires every listed node to be usable in endpoint `E`. The `__runsIn`
 * phantom is contravariant so a node whose allowed endpoints are a
 * superset of E satisfies the slot.
 */
export interface NodeLike<E extends EndpointKind = EndpointKind> {
  readonly kind?: "action" | "source" | "reuse";
  readonly name?: string;
  readonly __runsIn: (endpoint: E) => void;
}

export interface SDKActionGraphSpec<
  I extends Record<string, DependencyRef>,
  TOutput extends Record<string, unknown>,
> {
  readonly actions: readonly ActionLike[];
  readonly inputs: InputsObject<I>;
  readonly result: (dependencies: ResolveDependencyObject<I>) => TOutput;
  readonly error?: (args: { readonly error: unknown }) => TOutput;
}

export interface SDKActionContractShape<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
  TName extends string = string,
> {
  readonly kind: "sdk_action_contract";
  readonly name: TName;
  readonly displayName?: string;
  readonly description?: string;
  readonly mode: "sync";
  readonly resourceTypeId?: string;
  readonly actionTypes?: readonly string[];
  readonly inputs: {
    readonly [K in keyof TInput]: RequestArg<TInput[K], string>;
  };
  readonly inputSchema: readonly SDKActionFieldSpec[];
  readonly outputSchema: readonly SDKActionFieldSpec[];
}

export interface SDKActionContract<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
  TName extends string = string,
> extends SDKActionContractShape<TInput, TOutput, TName> {
  implement<const I extends Record<string, DependencyRef>>(
    spec: SDKActionGraphSpec<I, TOutput>,
  ): SDKActionImplementation<TInput, TOutput, I, TName>;
}

export interface SDKActionImplementation<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
  I extends Record<string, DependencyRef>,
  TName extends string = string,
> {
  readonly kind: "sdk_action";
  readonly contract: SDKActionContractShape<TInput, TOutput, TName>;
  readonly actions: readonly ActionLike[];
  readonly inputs: InputsObject<I>;
  readonly result: (dependencies: ResolveDependencyObject<I>) => TOutput;
  readonly error?: (args: { readonly error: unknown }) => TOutput;
}

export type SDKActionAuthorFactory<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
  TName extends string = string,
> = {
  <const I extends Record<string, DependencyRef>>(
    spec: SDKActionGraphSpec<I, TOutput>,
  ): SDKActionImplementation<TInput, TOutput, I, TName>;
  readonly kind: "sdk_action_author_factory";
  readonly displayName?: string;
  readonly description?: string;
  readonly mode: "sync";
  readonly resourceTypeId?: string;
  readonly actionTypes?: readonly string[];
  readonly inputs: {
    readonly [K in keyof TInput]: RequestArg<TInput[K], string>;
  };
  readonly inputSchema: readonly SDKActionFieldSpec[];
  readonly outputSchema: readonly SDKActionFieldSpec[];
};

export declare function sdkAction<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
  TName extends string = string,
>(spec: {
  readonly name: TName;
  readonly displayName?: string;
  readonly description?: string;
  readonly mode: "sync";
  readonly resourceTypeId?: string;
  readonly actionTypes?: readonly string[];
  readonly inputs: {
    readonly [K in keyof TInput]: RequestArg<TInput[K], string>;
  };
  readonly inputSchema: readonly SDKActionFieldSpec[];
  readonly outputSchema: readonly SDKActionFieldSpec[];
}): SDKActionContract<TInput, TOutput, TName>;

interface WalkSpecBase<
  R extends DependencyShape,
  TOut,
> extends Record<string, unknown> {
  readonly actions: readonly ActionLike[];
  readonly bind: R;
  readonly pagination?: WalkPagination;
  readonly lint?: ValidationDirective;
}

export interface ResourceEndpointSpec<
  R extends DependencyShape,
  TEmit extends Resource | readonly Resource[] = Resource | readonly Resource[],
> extends WalkSpecBase<R, Resource | readonly Resource[]> {
  readonly emit: (dependencies: ResolveDependencyGroups<R>) => ExactReturn<Resource | readonly Resource[], TEmit>;
}

export interface ResourceWalkSpec<
  R extends DependencyShape,
  TEmit extends Resource | readonly Resource[] = Resource | readonly Resource[],
> extends WalkSpecBase<R, Resource | readonly Resource[]> {
  readonly resources: (dependencies: ResolveDependencyGroups<R>) => ExactReturn<Resource | readonly Resource[], TEmit>;
}

export type RuntimeEntitlement = Omit<Entitlement, "resource"> & {
  readonly resource?: never;
};

/**
 * Per-resource-type entitlement template emitted by `staticEntitlements:`.
 *
 * The SDK fans the template out across every resource of the resource type,
 * deriving each entitlement's `id` from `(resource, slug)` and binding the
 * resource itself. Authors therefore declare only the fields that are constant
 * across resources of the same type. Per-resource entitlements still go through
 * `entitlements:` (a walker that has access to `scope.resource`).
 *
 * Empty `displayName` and `description` cause the SDK to fall back to the
 * resource's own values; `slug`, `grantableTo`, and `annotations` are copied
 * straight through.
 */
export type EntitlementTemplate = {
  readonly slug: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly purpose?: Entitlement["purpose"];
  readonly grantableTo?: readonly ResourceTypeReference[];
  readonly annotations?: readonly EntitlementAnnotation[];
};

export interface EntitlementWalkSpec<
  R extends DependencyShape,
  TEmit extends RuntimeEntitlement | readonly RuntimeEntitlement[] =
    RuntimeEntitlement | readonly RuntimeEntitlement[],
> extends WalkSpecBase<R, RuntimeEntitlement | readonly RuntimeEntitlement[]> {
  readonly entitlements: (
    dependencies: ResolveDependencyGroups<R>,
  ) => ExactReturn<RuntimeEntitlement | readonly RuntimeEntitlement[], TEmit>;
}

export interface EntitlementEndpointSpec<
  R extends DependencyShape,
  TEmit extends RuntimeEntitlement | readonly RuntimeEntitlement[] =
    RuntimeEntitlement | readonly RuntimeEntitlement[],
> extends WalkSpecBase<R, RuntimeEntitlement | readonly RuntimeEntitlement[]> {
  readonly emit: (
    dependencies: ResolveDependencyGroups<R>,
  ) => ExactReturn<RuntimeEntitlement | readonly RuntimeEntitlement[], TEmit>;
}

export type RuntimeGrantEntitlement =
  Pick<Entitlement, "id">
  & Partial<Omit<Entitlement, "id" | "resource">>
  & {
    readonly resource?: Resource;
  };

export type RuntimeGrant = Omit<Grant, "entitlement"> & {
  readonly entitlement: RuntimeGrantEntitlement;
};

export interface GrantWalkSpec<
  R extends DependencyShape,
  TEmit extends RuntimeGrant | readonly RuntimeGrant[] = RuntimeGrant | readonly RuntimeGrant[],
> extends WalkSpecBase<R, RuntimeGrant | readonly RuntimeGrant[]> {
  readonly grants: (dependencies: ResolveDependencyGroups<R>) => ExactReturn<RuntimeGrant | readonly RuntimeGrant[], TEmit>;
}

export interface GrantEndpointSpec<
  R extends DependencyShape,
  TEmit extends RuntimeGrant | readonly RuntimeGrant[] = RuntimeGrant | readonly RuntimeGrant[],
> extends WalkSpecBase<R, RuntimeGrant | readonly RuntimeGrant[]> {
  readonly emit: (dependencies: ResolveDependencyGroups<R>) => ExactReturn<RuntimeGrant | readonly RuntimeGrant[], TEmit>;
}

export interface ResourceTypeExecution {
  readonly maxParallelFetches?: number;
}

export interface ResourceTypeBaseSpec {
  readonly id: string;
  readonly parentId?: string;
  readonly displayName?: string;
  readonly traits?: readonly ResourceTypeTrait[];
  readonly annotations?: readonly ResourceTypeAnnotation[];
  readonly description?: string;
  readonly sourcedExternally?: boolean;
  readonly execution?: ResourceTypeExecution;
  readonly lint?: ValidationDirective;
}

export type RuntimeResourceTypeSpec<
  L extends DependencyShape = DependencyGroup,
  E extends DependencyShape = DependencyGroup,
  G extends DependencyShape = DependencyGroup,
  LT extends Resource | readonly Resource[] = Resource | readonly Resource[],
  ET extends RuntimeEntitlement | readonly RuntimeEntitlement[] =
    RuntimeEntitlement | readonly RuntimeEntitlement[],
  GT extends RuntimeGrant | readonly RuntimeGrant[] = RuntimeGrant | readonly RuntimeGrant[],
> = ResourceTypeBaseSpec & {
  readonly list?: ResourceEndpointSpec<L, LT>;
  readonly entitlements?: EntitlementEndpointSpec<E, ET>;
  readonly staticEntitlements?: readonly EntitlementTemplate[];
  readonly grants?: GrantEndpointSpec<G, GT>;
  readonly resourceLifecycle?: ResourceLifecycleImplementationSpec;
  readonly provisioning?: ProvisioningImplementationSpec;
  readonly credentialRotation?: {
    readonly walk: CredentialRotationEndpointSpec<Record<string, DependencyRef>>;
    readonly supportedCredentialOptions?: readonly CapabilityDetailCredentialOption[];
    readonly preferredCredentialOption?: CapabilityDetailCredentialOption;
  };
};

export type WalkSpec<R extends DependencyShape> =
  | ResourceWalkSpec<R>
  | EntitlementWalkSpec<R>
  | GrantWalkSpec<R>;

/**
 * A compiled graph walker.
 *
 * `I` is the shape of the walker's terminal inputs (the `from` record).
 * `TOut` is the exact return type of its `to` function, so the endpoint
 * slot it is assigned to can verify the emitter shape statically.
 */
export interface Walk<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  TOut = unknown,
  Nodes extends readonly NodeLike<any>[] = readonly NodeLike<any>[],
> {
  readonly kind: "walk";
  readonly nodes?: Nodes;
  readonly from: I;
  readonly when?: (dependencies: ResolveDependencyObject<I>) => boolean;
  readonly lint?: ValidationDirective;
  readonly to: (dependencies: ResolveDependencyObject<I>) => TOut;
}

/**
 * A DependencyRef that is valid inside a walker bound to endpoint `E`. Slots
 * and their wrappers pass through unchanged. RequestArgs are restricted to
 * those whose tagged endpoint set includes `E` — attempting to use
 * `scope.resource` (tagged for entitlements/grants/grant/revoke) inside a
 * `resources:` walker collapses that entry to `never` at the walker's `from`
 * field, which makes the walker fail to assign to the slot.
 */
type DepRefFor<E extends EndpointKind> =
  | Slot<any, any>
  | OptionalDependency<Slot<any, any>>
  | AggregateDependency<Slot<any, any>>
  | RequestArg<any, any, E>;

type WalkFor<E extends EndpointKind, TOut> = {
  readonly kind: "walk";
  readonly nodes?: readonly NodeLike<E>[];
  readonly from: Readonly<Record<string, DepRefFor<E>>>;
  readonly when?: (dependencies: any) => boolean;
  readonly lint?: ValidationDirective;
  readonly to: (dependencies: any) => TOut;
};

export type ResourceListEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  TEmit extends Resource | readonly Resource[] = Resource | readonly Resource[],
> = WalkFor<"resources", TEmit>;

export type ResourceEntitlementsEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  TEmit extends RuntimeEntitlement | readonly RuntimeEntitlement[] =
    RuntimeEntitlement | readonly RuntimeEntitlement[],
> = WalkFor<"entitlements", TEmit>;

export type ResourceGrantsEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  TEmit extends RuntimeGrant | readonly RuntimeGrant[] = RuntimeGrant | readonly RuntimeGrant[],
> = WalkFor<"grants", TEmit>;

export type TicketSchemaListEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "listTicketSchemas",
  | TicketSchema
  | readonly TicketSchema[]
  | TicketsServiceListTicketSchemasResponse
>;

export type TicketSchemaEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "getTicketSchema",
  | TicketSchema
  | readonly TicketSchema[]
  | TicketsServiceGetTicketSchemaResponse
  | undefined
>;

export type TicketEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  R = unknown,
  E extends "getTicket" | "createTicket" = "getTicket" | "createTicket",
> = WalkFor<E, Ticket | readonly Ticket[] | R | undefined>;

export interface TicketingImplementationSpec {
  readonly listTicketSchemas?: TicketSchemaListEndpointSpec;
  readonly getTicketSchema?: TicketSchemaEndpointSpec;
  readonly createTicket?: TicketEndpointSpec<Record<string, DependencyRef>, TicketsServiceCreateTicketResponse, "createTicket">;
  readonly getTicket?: TicketEndpointSpec<Record<string, DependencyRef>, TicketsServiceGetTicketResponse, "getTicket">;
  readonly execution?: {
    readonly maxParallelFetches?: number;
  };
}

export type ProvisionGrantEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  R = unknown,
> = WalkFor<"grant", Grant | readonly Grant[] | R | undefined>;

export type ProvisionRevokeEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
  R = unknown,
> = WalkFor<"revoke", R | undefined>;

export type ResourceGetEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "getResource",
  | Resource
  | ResourceGetterServiceGetResourceResponse
  | undefined
>;

export type ResourceCreateEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "createResource",
  | Resource
  | CreateResourceResponse
  | undefined
>;

export type ResourceDeleteEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "deleteResource",
  | DeleteResourceResponse
  | undefined
>;

export type CreateAccountEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "createAccount",
  | CreateAccountResultResponse
  | undefined
>;

export type CredentialRotationEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<
  "rotateCredential",
  | CredentialRotationResultResponse
  | undefined
>;

export type ConnectorValidateEndpointSpec<
  I extends Record<string, DependencyRef> = Record<string, DependencyRef>,
> = WalkFor<"validate", ConnectorServiceValidateResponse | undefined>;

export interface ResourceLifecycleImplementationSpec {
  readonly get?: ResourceGetEndpointSpec<Record<string, DependencyRef>>;
  readonly create?: ResourceCreateEndpointSpec<Record<string, DependencyRef>>;
  readonly delete?: ResourceDeleteEndpointSpec<Record<string, DependencyRef>>;
}

/**
 * A single account-creation input field, surfaced to C1 as
 * ConnectorMetadata.account_creation_schema.field_map. C1 renders the account
 * provisioning field-mapping UI from these declarations; `type` selects the
 * value kind shown in the mapping editor.
 */
export interface AccountCreationSchemaField {
  readonly displayName: string;
  readonly required?: boolean;
  readonly description?: string;
  readonly placeholder?: string;
  readonly order?: number;
  readonly deprecated?: boolean;
  readonly type: "string" | "stringList" | "bool" | "int" | "map";
}

export interface ProvisioningImplementationSpec {
  readonly grant?: ProvisionGrantEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceGrantResponse>;
  readonly revoke?: ProvisionRevokeEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceRevokeResponse>;
  readonly createAccount?: {
    readonly walk: CreateAccountEndpointSpec<Record<string, DependencyRef>>;
    readonly supportedCredentialOptions?: readonly CapabilityDetailCredentialOption[];
    readonly preferredCredentialOption?: CapabilityDetailCredentialOption;
    readonly schema?: Readonly<Record<string, AccountCreationSchemaField>>;
  };
}

export type AuthoredResourceTypeSpec = ResourceTypeBaseSpec & {
  readonly resources?: ResourceListEndpointSpec;
  readonly entitlements?: ResourceEntitlementsEndpointSpec;
  readonly staticEntitlements?: readonly EntitlementTemplate[];
  readonly grants?: ResourceGrantsEndpointSpec;
  readonly grant?: ProvisionGrantEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceGrantResponse>;
  readonly revoke?: ProvisionRevokeEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceRevokeResponse>;
  readonly resourceLifecycle?: ResourceLifecycleImplementationSpec;
  readonly provisioning?: ProvisioningImplementationSpec;
  readonly credentialRotation?: {
    readonly walk: CredentialRotationEndpointSpec<Record<string, DependencyRef>>;
    readonly supportedCredentialOptions?: readonly CapabilityDetailCredentialOption[];
    readonly preferredCredentialOption?: CapabilityDetailCredentialOption;
  };
};

export interface ConnectorSpec {
  readonly metadata?: Record<string, unknown>;
  readonly transports?: Record<string, unknown>;
  readonly actions?: Record<string, unknown>;
  readonly resourceTypes?: readonly AuthoredResourceTypeSpec[];
  readonly eventFeeds?: readonly EventFeedSpec<any>[];
  readonly ticketing?: TicketingImplementationSpec;
  readonly validate?: ConnectorValidateEndpointSpec;
  readonly execution?: {
    readonly maxParallelFetches?: number;
  };
  readonly lint?: ValidationDirective;
}

export declare function node<
  const O extends Record<string, OutputRef>,
  const R extends ActionRunShape<Record<never, never>>,
>(spec: {
  readonly name?: string;
  readonly inputs?: never;
  readonly outputs: OutputsObject<O>;
  readonly run: R;
  readonly result: (
    args: { readonly response: ActionResponseOf<R> },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly error?: (
    args: { readonly error: unknown },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly when?: (dependencies: Record<never, never>) => boolean;
  readonly execution?: ActionExecutionPolicy;
  readonly memo?: ActionMemoPolicy<Record<never, never>>;
  readonly lint?: ValidationDirective;
}): SourceActionSpec<O, R>;
export declare function node<
  const I extends Record<string, DependencyRef>,
  const O extends Record<string, OutputRef>,
  const R extends ActionRunShape<ResolveDependencyObject<I>>,
>(spec: {
  readonly name?: string;
  readonly inputs: I;
  readonly requires?: readonly DependencyRef[];
  readonly outputs: OutputsObject<O>;
  readonly run: R;
  readonly result: (
    args: ResolveDependencyObject<I> & { readonly response: ActionResponseOf<R> },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly error?: (
    args: ResolveDependencyObject<I> & { readonly error: unknown },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
  readonly when?: (dependencies: ResolveDependencyObject<I>) => boolean;
  readonly execution?: ActionExecutionPolicy;
  readonly memo?: ActionMemoPolicy<ResolveDependencyObject<I>>;
  readonly lint?: ValidationDirective;
}): ActionSpec<I, O, R>;

/**
 * walk() builds a terminal graph walker.
 *
 * Both input and output types are inferred from the spec:
 * `I` comes from `from`, and `TOut` comes from the `to` function's return
 * type. `TOut` is preserved on the returned {@link Walk} so endpoint slots
 * can statically verify that the emitter shape matches what that slot
 * requires (e.g. `resources` requires a `Resource` emitter).
 */
export declare function walk<
  const I extends Record<string, DependencyRef>,
  TOut,
  const Nodes extends readonly NodeLike<any>[] = readonly [],
>(spec: {
  readonly kind?: "walk";
  readonly nodes?: Nodes;
  readonly from: I;
  readonly when?: (dependencies: ResolveDependencyObject<I>) => boolean;
  readonly lint?: ValidationDirective;
  readonly to: (dependencies: ResolveDependencyObject<I>) => TOut;
}): Walk<I, TOut, Nodes>;

export declare function reuse<
  const RI extends ReuseInputObject,
  const O extends Record<string, OutputRef>,
  const R extends ActionRunShape<ResolveReuseInputObject<RI>>,
>(spec: {
  readonly inputs: RI;
  readonly cache?: ReuseCacheSpec<RI>;
  readonly outputs: OutputsObject<O>;
  readonly run: R;
  readonly result: (
    args: ResolveReuseInputObject<RI> & {
      readonly response: ActionResponseOf<R>;
    },
  ) => ResolveOutputObject<O> | readonly ResolveOutputObject<O>[];
}): ReuseDefinitionWithOutputs<RI, O, R>;
export declare function reuse<
  const RI extends ReuseInputObject,
  const R extends ActionRunShape<ResolveReuseInputObject<RI>>,
>(spec: {
  readonly inputs: RI;
  readonly cache?: ReuseCacheSpec<RI>;
  readonly run: R;
}): ReuseDefinitionWithoutOutputs<RI, R>;
type ResourceTypeSpecShape = ResourceTypeBaseSpec & {
  readonly resources?: ResourceListEndpointSpec;
  readonly entitlements?: ResourceEntitlementsEndpointSpec;
  readonly staticEntitlements?: readonly EntitlementTemplate[];
  readonly grants?: ResourceGrantsEndpointSpec;
  readonly grant?: ProvisionGrantEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceGrantResponse>;
  readonly revoke?: ProvisionRevokeEndpointSpec<Record<string, DependencyRef>, GrantManagerServiceRevokeResponse>;
  readonly resourceLifecycle?: ResourceLifecycleImplementationSpec;
  readonly provisioning?: ProvisioningImplementationSpec;
  readonly credentialRotation?: {
    readonly walk: CredentialRotationEndpointSpec<Record<string, DependencyRef>>;
    readonly supportedCredentialOptions?: readonly CapabilityDetailCredentialOption[];
    readonly preferredCredentialOption?: CapabilityDetailCredentialOption;
  };
};

export declare function resourceType<
  const TSpec extends ResourceTypeSpecShape,
>(spec: ExactObject<ResourceTypeSpecShape, TSpec>): TSpec;

export declare function connector<
  const TSpec extends ConnectorSpec,
>(spec: ExactObject<ConnectorSpec, TSpec>): TSpec;

export declare function isPlainObject(
  value: unknown,
): value is Record<string, unknown>;

export type PublicConfigString = PublicConfigField<string, string> | string;
export type SecretConfigString = SecretConfigField<string, string>;
export type AuthConfigString = PublicConfigString | SecretConfigString;

interface AuthStepRef<Name extends string = string> {
  readonly kind: "auth_step_ref";
  readonly name: Name;
}

export type AuthContext = "static" | "request" | "response";
export type AuthValueKind = "string" | "number" | "object";
export interface RuntimeValueExpression<C extends AuthContext = "static", K extends AuthValueKind = "string"> {
  readonly kind: "runtime_value_expr";
  readonly __authContext: C;
  readonly __authValueKind: K;
}
type AuthContextOf<V> = V extends RuntimeValueExpression<infer C, AuthValueKind> ? C : "static";
type AuthKindOf<V> = V extends RuntimeValueExpression<AuthContext, infer K> ? K : "string";
type AuthRequestValue = AuthConfigString | AuthStepRef | RuntimeValueExpression<"static" | "request", AuthValueKind>;
type AuthExtractValue = AuthConfigString | AuthStepRef | RuntimeValueExpression<"static" | "response", AuthValueKind>;


/**
 * An expiry built with `auth.at(...)` or `auth.after(...)`. `expires` takes
 * only these (or `"never"`), so a bare `auth.response.body("expires_in")`
 * is a compile error rather than a per-acquire failure in Go.
 */
export interface AuthExpiryExpression<C extends AuthContext = AuthContext> extends RuntimeValueExpression<C> {
  readonly __batonAuthExpiry: true;
}

export type RuntimeValue = AuthConfigString | RuntimeValueExpression;

type AuthResolvedValue = AuthConfigString | AuthStepRef | RuntimeValueExpression<AuthContext, AuthValueKind>;

type AuthStepRefs<Names extends string = string> = { readonly [K in Names]: AuthStepRef<K> };

export type AuthValue =
  | AuthResolvedValue
  | ((refs: AuthStepRefs) => AuthResolvedValue);

export declare const strings: {
  concat<const V extends readonly AuthResolvedValue[]>(...parts: V): RuntimeValueExpression<AuthContextOf<V[number]>>;
};

/**
 * Auth expression helpers. Every helper returns an opaque expression that is
 * serialized into the connector spec and evaluated in Go, per request,
 * against the acquired credentials and the outbound request. Secret values
 * referenced through `config()` or refs are never materialized in
 * JavaScript. Request-bound helpers (`request`, `headerOr`, `canonical*`) are
 * only valid inside `apply`; acquire-time fields (`token_url`, ...) have no
 * request yet.
 *
 * Variables are referenced through typed handles, never by string: the
 * `refs` object passed to `apply` (and to callback-valued fields) carries one
 * handle per named `credentials` entry and per named acquire step, and
 * `a.let(...)` returns a handle for an apply local.
 */
export declare const auth: AuthHelpers;

/**
 * One request in the "session_cookie" auth flow (the sign-in preflight or the
 * sign-out). url/header/query/body values take AuthConfigString: a literal
 * string or a config ref (including a secret config field, e.g. the sign-in
 * Authorization header). They are NOT full AuthValue: the dynamic auth helpers
 * (auth.ref/auth.bearer/strings.concat and (refs) => … callbacks) are not
 * normalized for these fields and fail closed at config load (a raw helper is
 * rejected as an unsupported auth helper; a callback fails to decode).
 * url is resolved against the transport base_url when relative.
 */
export interface HttpSessionRequestSpec {
  /** HTTP method; defaults to POST. */
  method?: string;
  url: AuthConfigString;
  headers?: Record<string, AuthConfigString>;
  query_params?: Record<string, AuthConfigString>;
  body?: AuthConfigString;
  /** Content-Type for the request body; defaults to application/json when a body is set. */
  content_type?: string;
}

/**
 * Value transforms, usable anywhere an auth expression is: `bearer`, `json`,
 * `sign`, `after`/`at`, `response.*`. Request introspection (`request`,
 * `headerOr`, `canonical*`, `signedHeaders`) is on the apply builder `a`
 * only, because it is meaningful only while an op runs against an outbound
 * request.
 */
export interface AuthValueHelpers {
  bearer<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  concat<const V0 extends readonly AuthResolvedValue[]>(...parts: V0): RuntimeValueExpression<AuthContextOf<V0[number]>, "string">;
  join<V0 extends AuthResolvedValue, const V1 extends readonly AuthResolvedValue[]>(sep: V0, ...parts: V1): RuntimeValueExpression<AuthContextOf<V0 | V1[number]>, "string">;
  lines<const V0 extends readonly AuthResolvedValue[]>(...parts: V0): RuntimeValueExpression<AuthContextOf<V0[number]>, "string">;
  /** First non-empty part. */
  coalesce<const V0 extends readonly AuthResolvedValue[]>(...parts: V0): RuntimeValueExpression<AuthContextOf<V0[number]>, "string">;
  /** Byte-offset slice `[start, end)`; `end` defaults to the end of the value. */
  substr<V0 extends AuthResolvedValue>(value: V0, start: number, end?: number): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  lower<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  upper<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  trim<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  base64<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  base64url<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  hex<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /** RFC 3986 unreserved-set percent-encoding with uppercase hex. */
  urlEncode<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /** Digest of value; `alg` is sha256 (default), sha1, sha384, sha512, or md5. Encoding defaults to hex. */
  hash<V0 extends AuthResolvedValue>(alg: AuthHashAlgorithm, value: V0, encoding?: AuthEncoding): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /**
   * HMAC of value under key. Encoding defaults to hex; `"raw"` yields the
   * binary MAC for use as the next key in a derivation chain (SigV4).
   */
  hmac<V0 extends AuthResolvedValue, V1 extends AuthResolvedValue>(alg: AuthHashAlgorithm, key: V0, value: V1, encoding?: AuthEncoding): RuntimeValueExpression<AuthContextOf<V0 | V1>, "string">;
  /**
   * The evaluation clock (UTC) in a named format (default "rfc3339") or a
   * token pattern such as "YYYY-MM-DDTHH:mm:ss+0000".
   */
  now(format?: AuthTimeFormat): RuntimeValueExpression<"static", "string">;
  /** Random hex token of `bytes` bytes (default 16). */
  nonce(bytes?: number): RuntimeValueExpression<"static", "string">;

  /**
   * Asymmetric signature of value under a PEM private key (RSA, EC, or
   * Ed25519; PKCS#1, SEC 1, or PKCS#8). Output is the JOSE-style raw
   * signature (r||s for ECDSA), encoded base64url by default. Symmetric
   * algorithms are refused: use `hmac`.
   */
  sign<V0 extends AuthResolvedValue, V1 extends AuthResolvedValue>(alg: AuthSignAlgorithm, key: V0, value: V1, encoding?: AuthEncoding): RuntimeValueExpression<AuthContextOf<V0 | V1>, "string">;
  /** Public JWK (JSON) of a private key, in RFC 7638 canonical member order. */
  jwk<V0 extends AuthResolvedValue>(key: V0): RuntimeValueExpression<AuthContextOf<V0>, "object">;
  /** RFC 7638 SHA-256 thumbprint (base64url) of a private key's public JWK. */
  jwkThumbprint<V0 extends AuthResolvedValue>(key: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /**
   * JSON object from named expressions. Members are strings unless wrapped:
   * `number(...)` emits a JSON number, `optional(...)` is dropped when
   * empty, nested `json(...)`/`jwk(...)` embed as objects. `undefined`
   * members are skipped. Keys are emitted sorted.
   */
  json<const V0 extends Record<string, AuthResolvedValue | undefined>>(fields: V0): RuntimeValueExpression<AuthContextOf<V0[keyof V0]>, "object">;
  /** Marks a `json` member as a number (the value must parse as one). */
  number<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "number">;
  /**
   * Marks a value as allowed to be empty: a `json` member wrapped in it is
   * dropped when empty, and a `response.body(...)` wrapped in it yields ""
   * for a missing member instead of failing the fetch.
   */
  optional<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, AuthKindOf<V0>>;
  /**
   * Compact JWS `header.payload.signature`. `header` is a `json(...)` of
   * extra JOSE parameters (typ, jwk, kid); `alg` is set by the signer.
   * `payload` is a `json(...)`. This is a DPoP proof, a private_key_jwt
   * client assertion, or any other per-request JWT.
   */
  jws<V0 extends AuthResolvedValue, H extends RuntimeValueExpression<AuthContext, "object"> | undefined, P extends RuntimeValueExpression<AuthContext, "object">>(alg: AuthSignAlgorithm, key: V0, header: H, payload: P): RuntimeValueExpression<AuthContextOf<V0 | H | P>, "string">;

  /**
   * Values from a `fetch` step's response; only meaningful in that step's
   * `value`, `expires`, and `outputs`. The same vocabulary as `page.*`.
   */
  readonly response: AuthResponseHelpers;
  /**
   * An absolute time `value` seconds from now (`expires_in`), for `expires`.
   * Accepts a number or a unit-suffixed duration ("90m").
   */
  after<V0 extends AuthResolvedValue>(value: V0): AuthExpiryExpression<AuthContextOf<V0>>;
  /**
   * An absolute time parsed leniently from `value`: epoch seconds or
   * milliseconds, RFC 3339 / ISO 8601 / HTTP-date strings. Give `format` (a
   * token pattern, `DD/MM/YYYY HH:mm`) for a vendor's unusual layout; it is
   * then used exclusively. Unparseable input is an error, never a default.
   */
  at<V0 extends AuthResolvedValue>(value: V0, format?: AuthTimeFormat): AuthExpiryExpression<AuthContextOf<V0>>;
  /** Raw bytes of a base64 value (std or URL alphabet, padded or not). */
  base64Decode<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /** Raw bytes of a hex value. */
  hexDecode<V0 extends AuthResolvedValue>(value: V0): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /**
   * One parameter of a challenge or credentials header value:
   * `authParam('Digest realm="x", nonce="y"', "nonce")` is `y`.
   */
  authParam<V0 extends AuthResolvedValue>(value: V0, name: string): RuntimeValueExpression<AuthContextOf<V0>, "string">;
  /**
   * `value` when `cond` is non-empty, else "". The one conditional: with
   * `optional(...)` around it, a header is withheld until a challenge has
   * been observed.
   */
  when<V0 extends AuthResolvedValue, V1 extends AuthResolvedValue>(cond: V0, value: V1): RuntimeValueExpression<AuthContextOf<V0 | V1>, AuthKindOf<V1>>;
}

/**
 * Readers of a `fetch` step's response. `body` reads the body parsed per the
 * step's `parseAs` (JSON by default, XML lowered to the same tree): a string
 * is one key, never split (`"access_token"`, `"@odata.nextLink"`), a list is
 * a nested path (`["data", "token"]`, `["items", "0", "id"]`). A missing
 * member fails the fetch unless wrapped in `auth.optional(...)`; a member
 * that is an object or array is an error. `raw` is the unparsed body;
 * `status` is the numeric status as a string.
 */
export interface AuthResponseHelpers {
  body(path: string | readonly [string, ...string[]]): RuntimeValueExpression<"response">;
  header(name: string): RuntimeValueExpression<"response">;
  cookie(name: string): RuntimeValueExpression<"response">;
  status(): RuntimeValueExpression<"response">;
  raw(): RuntimeValueExpression<"response">;
}

/**
 * The outbound request as it stands when an apply op runs. Only on the apply
 * builder: in an acquire step there is no request yet.
 */
export interface AuthRequestHelpers {
  /**
   * A field of the outbound request: method, url, scheme, host, path
   * (decoded), raw_path (escaped), query, body, header (with name),
   * query_param (with name).
   */
  request(field: "header" | "query_param", name: string): RuntimeValueExpression<"request">;
  request(field: Exclude<AuthRequestField, "header" | "query_param">): RuntimeValueExpression<"request">;
  /**
   * The request's current value for header `name`, or `fallback` when it is
   * absent: `coalesce(request("header", name), fallback)`. This is how a spec
   * lets a caller-supplied date or nonce win over a minted one.
   */
  headerOr(name: string, fallback: AuthRequestValue): RuntimeValueExpression<"request">;
  /** Sorted, percent-encoded query string (`a=1&b=2`). */
  canonicalQuery(style?: AuthQueryStyle): RuntimeValueExpression<"request">;
  /** `name:value\n` block of the selected headers, lowercased and sorted. */
  canonicalHeaders(selector: AuthHeaderSelector & {
    /** Defaults to collapse (SigV4); ACS3 requires trim, preserving internal whitespace. */
    readonly whitespace?: "collapse" | "trim";
  }): RuntimeValueExpression<"request">;
  /** `;`-joined lowercased names of the selected headers, sorted. */
  signedHeaders(selector: AuthHeaderSelector): RuntimeValueExpression<"request">;
  /**
   * OAuth 1.0a parameter normalization (RFC 5849 §3.4.1.3): the request's
   * query parameters and form body plus `extra` (the oauth_* protocol
   * parameters), percent-encoded, sorted, joined `k=v&k=v`. `include`
   * narrows the request sources (default both `"query"` and `"form"`).
   */
  canonicalParams(
    extra: Record<string, AuthRequestValue | undefined>,
    include?: readonly ("query" | "form")[],
  ): RuntimeValueExpression<"request">;
}

export interface AuthHelpers extends AuthValueHelpers {
  /**
   * http.v2 multi-step auth. Steps are added by name; a step's spec may be a
   * function of the refs bound so far (credentials, earlier
   * steps and their outputs), so every reference is a typed property access
   * and a typo is a compile error. See {@link AuthFlow}.
   */
  flow<
    const C extends Record<string, AuthExpr> = Record<never, never>,
    const R extends AuthReactRule = never,
  >(options?: { readonly credentials?: C; readonly react?: readonly R[] }): AuthFlow<keyof C & string, AuthReactNames<R>>;
}

/** `form` is `k=v&k=v` (SigV4, Alibaba); `lines` is `name:value` per line (Azure SharedKey). */
export type AuthQueryStyle = "form" | "lines";

export type AuthSignAlgorithm =
  | "ES256"
  | "ES384"
  | "ES512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "PS256"
  | "PS384"
  | "PS512"
  | "EdDSA";

export type AuthHashAlgorithm = "sha256" | "sha1" | "sha384" | "sha512" | "md5";
/**
 * Named clock formats, or a token pattern. Pattern tokens: YYYY, YY, MM, DD,
 * HH, mm, ss, SSS; `T` and `Z` are literal; digits and punctuation pass
 * through. Any other letter run is rejected in Go so a typo cannot render as
 * text.
 */
export type AuthTimeFormat =
  | "rfc3339" // 2013-05-24T00:00:00Z
  | "iso8601_no_zone" // 2013-05-24T00:00:00
  | "iso8601_basic" // 20130524T000000Z
  | "date" // 2013-05-24
  | "date_basic" // 20130524
  | "unix"
  | "unix_ms"
  | "http_date"
  | (string & Record<never, never>);
export type AuthEncoding = "hex" | "base64" | "base64url" | "raw";
export type AuthRequestField =
  | "method"
  | "url"
  | "scheme"
  | "host"
  | "path"
  | "raw_path"
  | "query"
  | "body"
  | "header"
  | "query_param"
  /** Body length in bytes; "" (not "0") when there is no body. */
  | "content_length";
export interface AuthHeaderSelector {
  /** Exact header names (case-insensitive). */
  readonly names?: readonly string[];
  /** Header name prefixes (case-insensitive), e.g. "x-amz-". */
  readonly prefixes?: readonly string[];
}

/**
 * The builder handed to `apply`. It is the `auth` helper set plus the four
 * ops; ops are recorded in call order. `let` returns a handle, so locals
 * flow into later ops as values rather than by name:
 *
 *   apply: (c, a) => {
 *     const ts = a.let(a.concat(a.now("iso8601_no_zone"), "+0000"));
 *     a.header("ss-request-timestamp", ts);
 *     a.header("ss-request-signature",
 *       a.hmac("sha256", c.api_secret, a.concat(c.api_key, a.request("path"), ts, a.request("body"))));
 *   }
 */
export interface AuthApplyBuilder extends AuthValueHelpers, AuthRequestHelpers {
  /** Evaluate once per request and bind; the optional label only names the local in error messages. */
  let<V extends AuthRequestValue>(value: V, label?: string): RuntimeValueExpression<AuthContextOf<V>, AuthKindOf<V>>;
  /** Set a request header (overwrites; wrap in `headerOr` to keep a caller-supplied value). */
  header(name: string, value: AuthRequestValue): void;
  query(name: string, value: AuthRequestValue): void;
  /** Fail the request (class invalid_input) when value is empty. */
  require(value: AuthRequestValue, message?: string): void;
}

/**
 * A response-driven rule. On every response, if `header` is present its
 * value is stored under `into` (persisting across requests and visible to
 * `apply` as `refs.<into>`, empty until first seen). If the status is also
 * in `retryOn` and the value changed, the request is re-signed once, including
 * writes. The rule asserts that authentication rejected the operation before
 * it was applied.
 * This is the DPoP-Nonce / challenge-header shape; it is not a retry policy.
 */
export interface AuthReactRule {
  readonly header: string;
  readonly into: string;
  readonly retryOn?: readonly number[];
}

/**
 * The frozen http.v1 auth surface, retained for existing connectors.
 *
 * @deprecated Author new connectors against `http.v2` ({@link HttpAuthV2}).
 * v1 to v2: `oauth2`/`oauth_app` are `oauth2_client_credentials`;
 * `bearer_dynamic`, `discover`, and `oauth2_password` are `fetch` steps;
 * the vendor HMAC types are `type: "request"` with apply ops.
 */
export type BuiltinHttpAuthSpec =
  | {
      name?: string;
      type: "bearer";
      token: AuthValue;
    }
  | {
      name?: string;
      type: "basic";
      username: AuthValue;
      password: AuthValue;
    }
  | {
      name?: string;
      type: "api_key";
      header?: AuthValue;
      prefix?: AuthValue;
      /**
       * When set, the token is sent as this query-string parameter instead of
       * a header (mirroring how `header` names the header). Use for providers
       * that read the credential only from the query string and ignore the
       * Authorization header (e.g. Countly's `?api_key=`). `header`/`prefix`
       * are ignored when `query` is present.
       */
      query?: string;
      token: AuthValue;
    }
  | {
      name?: string;
      /** @deprecated `oauth2` and `oauth_app` are aliases; v2 keeps only `oauth2_client_credentials`. */
      type: "oauth2" | "oauth2_client_credentials" | "oauth_app";
      token_url: AuthValue;
      client_id?: AuthValue;
      client_secret?: AuthValue;
      /**
       * How client credentials are sent to the token endpoint: "basic" (HTTP
       * Basic header, the default) or "body" (client_id/client_secret in the
       * form body). The remaining values are runtime-accepted compatibility
       * aliases ("header"/"in_header" for basic; "in_body"/"form"/"params"/
       * "post" for body) — prefer the canonical pair in new connectors.
       * Static config, not dynamic-resolvable — the Go transport normalizes
       * it once at construction and rejects any other value.
       */
      client_auth_style?: "basic" | "body" | "header" | "in_header" | "in_body" | "form" | "params" | "post";
      /**
       * Encoding for the OAuth token request body. Defaults to
       * "application/x-www-form-urlencoded"; use "application/json" only when
       * the provider explicitly requires a JSON client-credentials request.
       * Static config, not dynamic-resolvable.
       */
      token_request_content_type?: "application/x-www-form-urlencoded" | "application/json";
      scope?: AuthValue;
      scopes?: readonly AuthValue[];
      grant_type?: AuthValue;
      additional_headers?: Record<string, AuthValue>;
      additional_form_data?: Record<string, AuthValue>;
    }
  | {
      name?: string;
      /** @deprecated v2: a `fetch` step posting `grant_type=password` and the credentials as `form`. */
      type: "oauth2_password";
      token_url: AuthValue;
      username: AuthValue;
      password: AuthValue;
      client_id?: AuthValue;
      client_secret?: AuthValue;
      scope?: AuthValue;
      scopes?: readonly AuthValue[];
      token_expiry_padding?: number;
      additional_headers?: Record<string, AuthValue>;
      additional_form_data?: Record<string, AuthValue>;
    }
  | {
      name?: string;
      /** @deprecated v2: a `fetch` step (`url`, `form`, `headers`, `value`, `expires`). */
      type: "bearer_dynamic";
      token_url: AuthValue;
      username?: AuthValue;
      password?: AuthValue;
      token_field?: AuthValue;
      expiry_field?: AuthValue;
      expiry_format?: AuthValue;
      token_expiry_padding?: number;
      additional_headers?: Record<string, AuthValue>;
      additional_form_data?: Record<string, AuthValue>;
    }
  | {
      name?: string;
      type: "jwt";
      private_key: AuthValue;
      issuer: AuthValue;
      algorithm?: AuthValue;
      expiry_seconds?: number;
      additional_claims?: Record<string, AuthValue>;
      /**
       * Additional JWT (JOSE) header parameters beyond the signer-managed
       * "alg" and "typ". Values are arbitrary JSON so both scalar headers
       * (e.g. "x5t", "kid") and array headers (e.g. "x5c") are expressible.
       * The signer-managed "alg" header cannot be overridden.
       */
      jwt_headers?: Record<string, unknown>;
    }
  | {
      name?: string;
      /** @deprecated v2: a `fetch` step with `method: "GET"` and `expires: "never"`. */
      type: "discover";
      token_url: AuthValue;
      token_field: AuthValue;
      additional_headers?: Record<string, AuthValue>;
    }
  | {
      name?: string;
      /** @deprecated v2: `type: "request"` with the ACS3 canonical request as apply ops. */
      type: "alibaba_acs3_hmac_sha256";
      username: AuthValue;
      password: AuthValue;
    }
  | {
      name?: string;
      /** @deprecated v2: `type: "request"` with the ss-* HMAC headers as apply ops. */
      type: "sendsafely_hmac_sha256";
      /** SendSafely API key (public identifier), sent as the ss-api-key header. */
      username: AuthValue;
      /** SendSafely API secret, used as the HMAC-SHA256 signing key. */
      password: AuthValue;
    }
  | {
      name?: string;
      /**
       * Session-cookie auth: sign_in runs once before the first data call and
       * its Set-Cookie response seeds a cookie jar that the transport resends
       * on every later request. sign_out, if set, runs at the end of a
       * successful sync to close the session server-side. Use for APIs whose session lives only
       * in a cookie (e.g. BeyondTrust Password Safe SignAppin/Signout).
       */
      type: "session_cookie";
      sign_in: HttpSessionRequestSpec;
      sign_out?: HttpSessionRequestSpec;
    }
  | {
      steps: readonly BuiltinHttpAuthSpec[];
    };

/** @deprecated The http.v1 auth union; see {@link HttpAuthV2}. */
export type HttpAuthSpec = BuiltinHttpAuthSpec;

/** @deprecated The http.v1 transport spec; see {@link HttpTransportSpecV2}. */
export interface HttpTransportSpec<A> {
  baseUrl?: PublicConfigString;
  base_url?: PublicConfigString;
  auth?: A;
  headers?: Record<string, PublicConfigString>;
  retry?: RetryConfig;
}

// ---------------------------------------------------------------------------
// http.v2
//
// The consolidated auth surface: readable names for the common cases plus the
// two primitives everything lowers onto (`fetch` to acquire, `request` to
// shape). Field names are camelCase like the rest of the DSL; the runtime
// renames them onto the wire. Values are plain expressions, never callbacks:
// anything that needs an earlier step's output is written inside
// `auth.flow(...).step(name, (refs) => ...)`, where `refs` is exactly typed.
// ---------------------------------------------------------------------------

/** A value an http.v2 auth field accepts: a string, a config ref, a step ref, or an `auth.*` expression. */
export type AuthExpr = AuthConfigString | AuthStepRef | RuntimeValueExpression<"static", AuthValueKind>;

type AuthReactNames<R> = R extends { readonly into: infer V extends string } ? V : never;

export interface NoneAuthV2 {
  readonly type: "none";
}

/** `Authorization: Bearer <token>`. */
export interface BearerAuthV2 {
  readonly type: "bearer";
  readonly token: AuthExpr;
}

/** `Authorization: Basic base64(username:password)`. */
export interface BasicAuthV2 {
  readonly type: "basic";
  readonly username: AuthExpr;
  readonly password: AuthExpr;
}

/** A credential in a header (`<header>: <prefix> <token>`) or, with `query`, a query parameter. */
export interface ApiKeyAuthV2 {
  readonly type: "api_key";
  readonly token: AuthExpr;
  /** Header name; default Authorization. */
  readonly header?: AuthExpr;
  /** Value prefix, e.g. "Bearer" or "Token"; default none. */
  readonly prefix?: AuthExpr;
  /** When set, send the token as this query parameter instead of a header. */
  readonly query?: string;
}

/**
 * RFC 6749 client_credentials grant against `tokenUrl`, cached until
 * `expires_in`. `clientAuthStyle` is how the client authenticates: "basic"
 * (HTTP Basic, the default), "body" (form fields), or "client_assertion"
 * (an RFC 7523 JWT signed with `privateKey`; `clientSecret` is not sent).
 */
interface OAuth2ClientCredentialsFields {
  readonly type: "oauth2_client_credentials";
  readonly tokenUrl: AuthExpr;
  readonly clientId?: AuthExpr;
  readonly scope?: AuthExpr;
  readonly scopes?: readonly AuthExpr[];
  /** Override the grant_type form field (default client_credentials). */
  readonly grantType?: AuthExpr;
  readonly headers?: Record<string, AuthExpr>;
  readonly form?: Record<string, AuthExpr>;
  /** Seconds before expiry to refresh; default 30. */
  readonly tokenExpiryPadding?: number;
}

/** The client secret goes in a Basic header (default) or in the form body. */
interface OAuth2ClientSecretAuth extends OAuth2ClientCredentialsFields {
  readonly clientId: AuthExpr;
  readonly clientAuthStyle?: "basic" | "body";
  readonly clientSecret: AuthExpr;
  readonly privateKey?: never;
  readonly algorithm?: never;
  readonly expirySeconds?: never;
  readonly claims?: never;
  readonly jwtHeaders?: never;
}

/** RFC 7523 client_assertion: the client proves itself with a JWT signed by `privateKey`. */
interface OAuth2ClientAssertionAuth extends OAuth2ClientCredentialsFields {
  readonly clientAuthStyle: "client_assertion";
  readonly clientSecret?: never;
  /** PEM signing key for the assertion. */
  readonly privateKey: AuthExpr;
  /** Default RS256. */
  readonly algorithm?: AuthSignAlgorithm;
  readonly expirySeconds?: number;
  readonly claims?: Record<string, AuthExpr>;
  readonly jwtHeaders?: Record<string, unknown>;
}

export type OAuth2ClientCredentialsAuthV2 = OAuth2ClientSecretAuth | OAuth2ClientAssertionAuth;

/** A self-minted JWT (RSA or EC) presented as the bearer token or fed to a later step. */
export interface JwtAuthV2 {
  readonly type: "jwt";
  readonly privateKey: AuthExpr;
  readonly issuer: AuthExpr;
  /** Default RS256. */
  readonly algorithm?: AuthSignAlgorithm;
  readonly expirySeconds?: number;
  readonly claims?: Record<string, AuthExpr>;
  /** Extra JOSE header parameters (kid, x5t, x5c); "alg" cannot be overridden. */
  readonly jwtHeaders?: Record<string, unknown>;
}

/**
 * Acquire a value with one HTTP request and read it out of the response.
 * This is the one acquire primitive: a proprietary login endpoint, a
 * refresh-token grant, a discovery call, a DPoP-bound token request.
 *
 * `Names` is the set of refs visible to this step's own `apply` (its
 * position in an {@link AuthFlow}); at the top level there are none.
 */
interface FetchAuthFields<Names extends string, R extends AuthReactRule> {
  readonly type: "fetch";
  readonly url: AuthExpr;
  /** Default POST. GET/HEAD send no body. */
  readonly method?: "POST" | "GET" | "PUT" | "PATCH" | "HEAD";
  readonly headers?: Record<string, AuthExpr>;
  /**
   * When the value expires. Required, so the choice is visible:
   * `auth.after(...)` for a relative lifetime (`expires_in`), `auth.at(...)`
   * for an absolute time, or `"never"` for a value that is cached until a
   * 401 invalidates it (a discovered id or URL, a session cookie the vendor
   * does not time out). Strict: an expiry that does not parse fails the
   * fetch.
   */
  readonly expires: AuthExpiryExpression<"static" | "response"> | "never";
  /** Further response values, published on `refs` under their own names. */
  readonly outputs?: Record<string, AuthExtractValue>;
  readonly tokenExpiryPadding?: number;
  /** Shape (sign) the token request itself. */
  readonly apply?: (refs: AuthStepRefs<Names | R["into"]>, a: AuthApplyBuilder) => void;
  /** Absorb the token endpoint's challenges (DPoP-Nonce). */
  readonly react?: readonly R[];
}
/**
 * JSON defaults to the top-level `access_token` field. XML drops namespace
 * prefixes and exposes attributes as `-name`; text has no parsed body tree.
 */
type FetchAuthResponse =
  | { readonly parseAs?: "json"; readonly value?: AuthExtractValue }
  | { readonly parseAs: "xml" | "text"; readonly value: AuthExtractValue };

export type AuthJSONBody = null | boolean | number | AuthExpr | readonly AuthJSONBody[] | { readonly [key: string]: AuthJSONBody };
type FetchAuthBody =
  | { readonly form?: Record<string, AuthExpr>; readonly json?: never; readonly body?: never }
  | { readonly form?: never; readonly json: AuthJSONBody; readonly body?: never }
  | { readonly form?: never; readonly json?: never; readonly body: AuthExpr };
type FetchAuthSpec<Names extends string, R extends AuthReactRule, O extends Record<string, AuthExtractValue>> =
  Omit<FetchAuthFields<Names, R>, "outputs"> & FetchAuthBody & FetchAuthResponse & { readonly outputs?: O };
export type FetchAuthV2<Names extends string = never, R extends AuthReactRule = never> = FetchAuthFields<Names, R> & FetchAuthBody & FetchAuthResponse;


/**
 * Shape every outbound request from static credentials: extra credential
 * headers, query-string credentials, canonical-request signing. `refs`
 * carries one handle per `credentials` key and per `react` var. For a
 * request auth that first acquires values, use {@link AuthFlow}.
 */
export interface RequestAuthV2<
  C extends Record<string, AuthExpr> = Record<never, never>,
  R extends AuthReactRule = never,
> {
  readonly type: "request";
  /** Request auth uses named credentials; legacy credential slots are forbidden. */
  readonly token?: never;
  readonly username?: never;
  readonly password?: never;
  readonly credentials?: C;
  readonly apply: (refs: AuthStepRefs<(keyof C & string) | AuthReactNames<R>>, a: AuthApplyBuilder) => void;
  readonly react?: readonly R[];
}

export type AuthFlowStep<Names extends string> =
  | BearerAuthV2
  | JwtAuthV2
  | OAuth2ClientCredentialsAuthV2
  | FetchAuthV2<Names>;

type AuthFlowStepNames<S> =
  | (S extends { readonly outputs: infer O } ? keyof O & string : never)
  | (S extends { readonly react: readonly (infer R)[] } ? AuthReactNames<R> : never);

export type AuthFetchRequest = Pick<FetchAuthFields<never, never>, "url" | "method" | "headers"> & FetchAuthBody;
type AuthFlowFetch<Names extends string, R extends AuthReactRule, O extends Record<string, AuthExtractValue>> =
  Pick<FetchAuthFields<Names, R>, "expires" | "tokenExpiryPadding" | "react" | "apply"> & FetchAuthResponse & {
    readonly request: AuthFetchRequest | ((refs: AuthStepRefs<Names>) => AuthFetchRequest);
    readonly outputs?: O;
  };

/**
 * A multi-step auth built by `auth.flow(...)`. Steps run in order; each
 * named step (and each of its `outputs`) becomes a property
 * of `refs` for every later step and for `apply`. With no `apply`, the last
 * step's value is sent as `Authorization: Bearer`.
 *
 *   auth: auth.flow()
 *     .step("jwt", { type: "jwt", privateKey: cfg.key(), issuer: cfg.appId(), algorithm: "RS256" })
 *     .step("installation", (refs) => ({
 *       type: "fetch", method: "GET", url: `${base}/app/installations`,
 *       value: auth.response.body(["0", "id"]), expires: "never",
 *       headers: { Authorization: auth.bearer(refs.jwt) },
 *     }))
 *     .step("token", (refs) => ({
 *       type: "fetch", url: auth.concat(base, "/app/installations/", refs.installation, "/access_tokens"),
 *       value: auth.response.body("token"), expires: auth.at(auth.response.body("expires_at")),
 *       headers: { Authorization: auth.bearer(refs.jwt) },
 *     }))
 */
export interface AuthFlow<Names extends string = never, ResourceNames extends string = never> {
  /** Acquire a named value; request sees prior refs, apply also sees local reaction names. */
  fetch<const N extends string, const R extends AuthReactRule = never, const O extends Record<string, AuthExtractValue> = Record<never, never>>(
    name: N, spec: AuthFlowFetch<Names, R, O>,
  ): AuthFlow<Names | N | (keyof O & string), ResourceNames>;
  step<const N extends string, const R extends AuthReactRule = never, const O extends Record<string, AuthExtractValue> = Record<never, never>>(
    name: N, spec: FetchAuthSpec<Names, R, O>,
  ): AuthFlow<Names | N | (keyof O & string), ResourceNames>;
  step<const N extends string, const R extends AuthReactRule = never, const O extends Record<string, AuthExtractValue> = Record<never, never>>(
    name: N, build: (refs: AuthStepRefs<Names>) => FetchAuthSpec<Names, R, O>,
  ): AuthFlow<Names | N | (keyof O & string), ResourceNames>;
  readonly __batonAuthKind: "flow";
  step<const N extends string, const S extends Exclude<AuthFlowStep<Names>, { readonly type: "fetch" }>>(
    name: N,
    spec: S & NoExcessAuthStepKeys<Names, S>,
  ): AuthFlow<Names | N | AuthFlowStepNames<S>, ResourceNames>;
  step<const N extends string, const S extends Exclude<AuthFlowStep<Names>, { readonly type: "fetch" }>>(
    name: N,
    build: (refs: AuthStepRefs<Names>) => S & NoExcessAuthStepKeys<Names, S>,
  ): AuthFlow<Names | N | AuthFlowStepNames<S>, ResourceNames>;
  /** Shape every outbound request from the acquired refs. Closes the flow: no further steps. */
  apply(build: (refs: AuthStepRefs<Names | ResourceNames>, a: AuthApplyBuilder) => void): AuthFlowComplete;
}

/** A flow closed by `.apply(...)`; only usable as an `auth:` value. */
export interface AuthFlowComplete {
  readonly __batonAuthKind: "flow";
  readonly __batonAuthFlowComplete: true;
}

type AuthFlowStepByType<Names extends string, T> = Extract<AuthFlowStep<Names>, { readonly type: T }>;
/**
 * Top-level keys of a step literal that its `type` does not declare, mapped
 * to never: a v1 spelling (`token_field`) or a typo is a compile error in
 * both the object and the callback form (the generic surfaces infer the
 * literal wholesale, so ordinary excess-property checking never fires).
 */
type NoExcessAuthStepKeys<Names extends string, S> =
  S extends { readonly type: infer T }
    ? { readonly [K in Exclude<keyof S, keyof AuthFlowStepByType<Names, T>>]: never }
    : never;

// Forbid fields owned by another auth variant even through variables/spreads.
// Distribute over both unions so each variant keeps its own contextual types.
type AuthVariantKeys<T> = T extends unknown ? keyof T : never;
type ExclusiveAuthVariant<T, All = T> = T extends unknown
  ? T & { readonly [K in Exclude<AuthVariantKeys<All>, keyof T>]?: never }
  : never;

type HttpAuthV2Variants =
  | NoneAuthV2
  | BearerAuthV2
  | BasicAuthV2
  | ApiKeyAuthV2
  | OAuth2ClientCredentialsAuthV2
  | JwtAuthV2
  | FetchAuthV2
  | AuthFlow<any>
  | AuthFlowComplete;

export type HttpAuthV2 = ExclusiveAuthVariant<HttpAuthV2Variants>;

/** Token-bucket client-side rate limiting, optionally steered by the provider's rate-limit headers. */
export interface HttpRateLimitsV2 {
  readonly requestsPerSecond?: number;
  readonly burstSize?: number;
  readonly responseDetection?: {
    /** Statuses that mean "rate limited" on their own (429, a vendor's 403-with-quota): back off by the reset header, else Retry-After, else 5s. */
    readonly statusCodes?: readonly number[];
    /** Header carrying the remaining budget; at 0 the transport backs off. Default X-RateLimit-Remaining. */
    readonly headerNameRemaining?: string;
    /** Header carrying the reset time (epoch seconds or delta seconds). Default X-RateLimit-Reset. */
    readonly headerNameReset?: string;
  };
}

export interface HttpTlsV2 {
  readonly insecureSkipVerify?: boolean;
  readonly caCert?: PublicConfigString;
  readonly caCertPath?: PublicConfigString;
  readonly clientCert?: PublicConfigString;
  readonly clientCertPath?: PublicConfigString;
  readonly clientKey?: AuthConfigString;
  readonly clientKeyPath?: PublicConfigString;
}

export interface HttpTransportSpecV2<A> {
  readonly baseUrl: PublicConfigString;
  readonly auth?: A;
  readonly headers?: Record<string, PublicConfigString>;
  readonly retry?: RetryConfigV2;
  /** Per-request timeout as a Go duration ("30s"). */
  readonly timeout?: string;
  readonly rateLimits?: HttpRateLimitsV2;
  readonly proxyUrl?: PublicConfigString;
  readonly tls?: HttpTlsV2;
}

export declare const http: {
  /**
   * http.v2: the consolidated auth surface (see {@link HttpAuthV2}) and the
   * transport knobs the runtime actually reads. `C` and `R` are inferred
   * from a `type: "request"` auth so its `apply` sees exactly the names it
   * declares; multi-step auth is `auth.flow(...)`.
   */
  v2<
    const C extends Record<string, AuthExpr> = Record<never, never>,
    const R extends AuthReactRule = never,
  >(spec: HttpTransportSpecV2<ExclusiveAuthVariant<Exclude<HttpAuthV2, FetchAuthV2> | FetchAuthV2<never, R> | RequestAuthV2<C, R>>>): HttpTransportV2;

  /**
   * @deprecated http.v1 is frozen. New connectors use `http.v2`, which has
   * one auth surface (see {@link HttpAuthV2}) and camelCase fields; see
   * docs/HTTP_V2_ROLLOUT.md for the per-type rewrite. The runtime rejects
   * v2-only auth (`request`, `fetch`, `react`, the `auth.*` helpers beyond
   * `bearer`/`concat`) under v1.
   */
  v1(spec: HttpTransportSpec<BuiltinHttpAuthSpec>): HttpTransport;
};

export namespace events {
  export type Response =
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly usageEvent: {
          readonly targetResource: Resource;
          readonly actorResource: Resource;
        };
      }
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly grantEvent: {
          readonly grant: Grant;
        };
      }
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly revokeEvent: {
          readonly resource: Resource;
          readonly entitlement: Entitlement;
        };
      }
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly resourceChangeEvent: {
          readonly resourceId: ResourceId;
          readonly parentResourceId: ResourceId;
        };
      }
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly createGrantEvent: {
          readonly entitlement: Entitlement;
          readonly principal: PrincipalResource;
          readonly annotations: GrantAnnotation;
        };
      }
    | {
        readonly id: string;
        readonly occurredAt: Date;
        readonly createRevokeEvent: {
          readonly entitlement: Entitlement;
          readonly principal: PrincipalResource;
          readonly annotations: GrantAnnotation;
        };
      };

  export interface Result {
    readonly events: Response | readonly Response[];
    readonly cursor: string;
    readonly hasMore: boolean;
  }

  export interface Spec<
    I extends Record<string, DependencyRef>,
  > extends NodeBaseSpec<ResolveDependencyObject<I>> {
    readonly id: string;
    readonly supportedEventTypes: EventType[];
    readonly actions: readonly ActionLike[];
    readonly inputs: InputsObject<I>;
    readonly lint?: ValidationDirective;
    readonly events: (args: ResolveDependencyObject<I>) => Result;
  }
}

export declare function eventFeed<const I extends Record<string, DependencyRef>>(
    spec: EventFeedSpec<I>,
): EventFeedSpec<I>;

export type SqlAuthSpec = {
  password: AuthValue;
}

export interface SqlQuerySpec {
  readonly query: string;
  readonly params?: Record<string, unknown>;
  readonly pagination?: SqlPaginationSpec;
}

export interface SqlTransport extends Transport {
  query<TActual extends SqlQuerySpec>(
    spec: TActual & ExactSqlPaginationField<TActual> & NoExcessTopLevelKeys<SqlQuerySpec, TActual>,
  ): SqlExecution<any>;
}

type DatabaseDriver = "pgx/v5" | "pgx" | "sqlserver"

export declare const sql: {
  v1(spec: {
    database_driver: DatabaseDriver;
    auth: SqlAuthSpec
    host: PublicConfigString;
    port: PublicConfigString;
    database: PublicConfigString;
    user: PublicConfigString;
    params?: Record<string, string>;
    retry?: {
      max_retries?: number;
      retry_interval?: string;
      retry_multiplier?: number;
      max_retry_interval?: string;
      retryable_classes?: readonly string[];
    };
  }): SqlTransport;
};
