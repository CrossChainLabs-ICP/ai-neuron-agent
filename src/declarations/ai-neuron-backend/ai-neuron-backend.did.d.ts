import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface ReportsStorage {
  'autoscale' : ActorMethod<[], bigint>,
  'balance' : ActorMethod<[], bigint>,
  'delete_workers' : ActorMethod<[], undefined>,
  'get_workers' : ActorMethod<[], Array<string>>,
  'saveReport' : ActorMethod<[string, string, string], boolean>,
  'upgrade' : ActorMethod<[Uint8Array | number[]], undefined>,
}
export interface _SERVICE extends ReportsStorage {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
