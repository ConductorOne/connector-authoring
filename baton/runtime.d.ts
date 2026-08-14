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

/**
 * A runtime-owned transport declaration. Config and authentication members
 * remain unresolved references in authored code.
 */
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
 * Create an opaque reference to a connector configuration field. The hosted
 * runtime resolves its value. In authored connectors, cast the reference to
 * PublicConfigField or SecretConfigField to match the field's schema declaration.
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
 * Node-level pagination contract. Authors declare the policy and response
 * paths; the hosted runtime advances pages. The discriminant is `kind`; each
 * kind requires the fields the runtime reads, so a typo or missing parameter
 * is a compile error instead of a silently wrong request.
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
export interface PageNumberQueryPaginationSpec extends PaginationSpecBase {
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
export interface PageNumberBodyPaginationSpec extends PaginationSpecBase {
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
export interface OffsetQueryPaginationSpec extends PaginationSpecBase {
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
export interface OffsetBodyPaginationSpec extends PaginationSpecBase {
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

export type PaginationSpec =
  | TransportPaginationSpec
  | LinkPaginationSpec
  | ResponseTokenPaginationSpec
  | CursorPaginationSpec
  | PageNumberQueryPaginationSpec
  | PageNumberBodyPaginationSpec
  | OffsetQueryPaginationSpec
  | OffsetBodyPaginationSpec;

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

export type RawHttpExecutionSpec<Method extends string = string> = {
  readonly path: string;
  readonly query?: Record<string, unknown>;
  readonly headers?: Record<string, unknown>;
  readonly body?: unknown;
  readonly itemsPath?: readonly string[];
  readonly pagination?: PaginationSpec;
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | false;
  readonly method?: Method;
};

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
  readonly pagination?: PaginationSpec;
}>;

type OperationRequestPortion<T> =
  T extends object ? Omit<T, "projection" | "itemsPath" | "pagination"> : never;

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
type ExactPaginationField<TActual> =
  TActual extends { readonly pagination: infer P }
    ? { readonly pagination: ExactReturn<PaginationSpec, P> }
    : TActual extends { readonly pagination?: infer P }
      ? { readonly pagination?: ExactReturn<PaginationSpec, NonNullable<P>> }
      : { readonly pagination?: PaginationSpec };

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

export interface HttpTransport extends Transport {
  request<
    O extends { readonly types: { readonly request: unknown } },
    P extends ProjectionHandle<any>,
    TActual,
  >(
    operation: O,
    spec: {
      readonly projection: P;
      readonly itemsPath?: readonly string[];
      readonly pagination?: PaginationSpec;
    } & TActual & ExactReturn<O["types"]["request"], OperationRequestPortion<TActual>> & ExactPaginationField<TActual>,
  ): HttpExecution<ProjectionValue<P>>;
  request<
    O extends { readonly types: { readonly request: unknown } },
    TActual,
  >(
    operation: O,
    spec: TActual & {
      readonly itemsPath?: readonly string[];
      readonly pagination?: PaginationSpec;
    } & ExactReturn<O["types"]["request"], OperationRequestPortion<TActual>> & ExactPaginationField<TActual>,
  ): HttpExecution<unknown>;
  request<
    O extends AnyOperationHandle,
    P extends ProjectionHandle<any>,
    TActual,
  >(
    operation: O,
    spec: TActual & {
      readonly projection: P;
      readonly itemsPath?: readonly string[];
      readonly pagination?: PaginationSpec;
    } & ExactReturn<OperationRequestOf<O>, OperationRequestPortion<TActual>> & ExactPaginationField<TActual>,
  ): HttpExecution<ProjectionValue<P>>;
  request<
    O extends AnyOperationHandle,
    TActual,
  >(
    operation: O,
    spec: TActual & {
      readonly itemsPath?: readonly string[];
      readonly pagination?: PaginationSpec;
    } & ExactReturn<OperationRequestOf<O>, OperationRequestPortion<TActual>> & ExactPaginationField<TActual>,
  ): HttpExecution<OperationResponseOf<O>>;
  GET<TActual extends RawHttpExecutionSpec<"GET">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"GET">, TActual>,
  ): HttpExecution<unknown>;
  POST<TActual extends RawHttpExecutionSpec<"POST">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"POST">, TActual>,
  ): HttpExecution<unknown>;
  PUT<TActual extends RawHttpExecutionSpec<"PUT">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"PUT">, TActual>,
  ): HttpExecution<unknown>;
  PATCH<TActual extends RawHttpExecutionSpec<"PATCH">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"PATCH">, TActual>,
  ): HttpExecution<unknown>;
  DELETE<TActual extends RawHttpExecutionSpec<"DELETE">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"DELETE">, TActual>,
  ): HttpExecution<unknown>;
  HEAD<TActual extends RawHttpExecutionSpec<"HEAD">>(
    spec: TActual & ExactPaginationField<TActual> & NoExcessTopLevelKeys<RawHttpExecutionSpec<"HEAD">, TActual>,
  ): HttpExecution<unknown>;
}

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
  readonly pagination?: PaginationSpec;
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | false;
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
  readonly pagination?: PaginationSpec;
  readonly failure_classifier?: FailureClassifierConfig | false;
  readonly retry?: RetryConfig | false;
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
 * `"rate_limited"` or `"transient"`.
 */
export interface RetryConfig {
  readonly max_retries?: number;
  readonly retry_interval?: string;
  readonly retry_multiplier?: number;
  readonly max_retry_interval?: string;
  readonly retryable_classes?: readonly string[];
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
  /**
   * Registers every transport referenced by a node, using the same object
   * identity. Omitting a referenced transport can typecheck but fails when the
   * connector is invoked.
   */
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

/**
 * Declares an operation in the connector graph. `run` returns one or more
 * execution descriptors; the hosted runtime performs I/O; `result` maps the
 * returned data to output slots. Do not call `fetch` or manually page here.
 */
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
 * walk() declares a terminal mapping from supplied or runtime values to
 * resources, entitlements, or grants. The hosted runtime evaluates its
 * declared nodes and transport descriptors.
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

export interface RuntimeValueExpression {
  readonly kind: "runtime_value_expr";
}

export type RuntimeValue = AuthConfigString | RuntimeValueExpression;

type AuthResolvedValue = AuthConfigString | AuthStepRef | RuntimeValueExpression;

type AuthStepRefs<Names extends string = string> = Readonly<Record<Names, AuthStepRef<Names>>>;

export type AuthValue =
  | AuthResolvedValue
  | ((refs: AuthStepRefs) => AuthResolvedValue);

export declare const strings: {
  concat(...parts: readonly AuthResolvedValue[]): RuntimeValueExpression;
};

export declare const auth: {
  bearer(value: AuthResolvedValue): RuntimeValueExpression;
};

/**
 * Declarative HTTP authentication. Public and secret config values are opaque
 * runtime references; authored code must not inspect, transform, or log secret
 * values.
 */
export type HttpAuthSpec =
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
      scope?: AuthValue;
      scopes?: readonly AuthValue[];
      grant_type?: AuthValue;
      additional_headers?: Record<string, AuthValue>;
      additional_form_data?: Record<string, AuthValue>;
    }
  | {
      name?: string;
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
      type: "discover";
      token_url: AuthValue;
      token_field: AuthValue;
      additional_headers?: Record<string, AuthValue>;
    }
  | {
      name?: string;
      type: "alibaba_acs3_hmac_sha256";
      username: AuthValue;
      password: AuthValue;
    }
  | {
      name?: string;
      type: "sendsafely_hmac_sha256";
      /** SendSafely API key (public identifier), sent as the ss-api-key header. */
      username: AuthValue;
      /** SendSafely API secret, used as the HMAC-SHA256 signing key. */
      password: AuthValue;
    }
  | {
      steps: readonly HttpAuthSpec[];
    };

export declare const http: {
  /**
   * Declares an HTTP transport. Verb calls build execution expressions; they
   * do not send requests immediately.
   */
  v1(spec: {
    baseUrl?: PublicConfigString;
    base_url?: PublicConfigString;
    auth?: HttpAuthSpec;
    headers?: Record<string, PublicConfigString>;
    retry?: {
      max_retries?: number;
      retry_interval?: string;
      retry_multiplier?: number;
      max_retry_interval?: string;
      retryable_classes?: readonly string[];
    };
  }): HttpTransport;
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
