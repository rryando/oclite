import * as CassetteModule from "./cassette"
import { cassetteLayer as makeCassetteLayer, recordingLayer as makeRecordingLayer } from "./effect"
import {
  redactHeaders as redactHeaderValues,
  redactUrl as redactUrlValue,
  secretFindings as findSecrets,
} from "./redaction"
import { makeWebSocketExecutor as makeWebSocket } from "./websocket"

export type {
  CassetteMetadata,
  HttpInteraction,
  Interaction,
  RequestSnapshot,
  ResponseSnapshot,
  WebSocketFrame,
  WebSocketInteraction,
} from "./schema"
export { CassetteNotFoundError, hasCassetteSync, UnsafeCassetteError } from "./cassette"
export { defaultMatcher, type RequestMatcher } from "./matching"
export { redactHeaders, redactUrl, secretFindings, type SecretFinding } from "./redaction"
export { cassetteLayer, recordingLayer, type RecordReplayMode, type RecordReplayOptions } from "./effect"
export {
  makeWebSocketExecutor,
  type WebSocketConnection,
  type WebSocketExecutor,
  type WebSocketRecordReplayOptions,
  type WebSocketRequest,
} from "./websocket"

export * as Cassette from "./cassette"
export * as Redactor from "./redactor"

/** HTTP cassette recording and replay. */
export class HttpRecorder {
  static readonly http = makeCassetteLayer
  static readonly cassetteLayer = makeCassetteLayer
  static readonly recordingLayer = makeRecordingLayer
  static readonly hasCassetteSync = CassetteModule.hasCassetteSync
  static readonly redactHeaders = redactHeaderValues
  static readonly redactUrl = redactUrlValue
  static readonly secretFindings = findSecrets
  static readonly makeWebSocketExecutor = makeWebSocket

  private constructor() {}
}

export namespace HttpRecorder {
  export type CassetteMetadata = import("./schema").CassetteMetadata
  export type RecorderOptions = import("./effect").RecordReplayOptions
  export type RecordReplayOptions = import("./effect").RecordReplayOptions
  export type RequestMatcher = import("./matching").RequestMatcher
  export type RequestSnapshot = import("./schema").RequestSnapshot
  export import Cassette = CassetteModule
}
