import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface ReportStorage {
  'getReport' : ActorMethod<[string], [] | [string]>,
  'listReports' : ActorMethod<[], Array<string>>,
  'saveReport' : ActorMethod<[string, string], [] | [string]>,
}
export interface _SERVICE extends ReportStorage {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
