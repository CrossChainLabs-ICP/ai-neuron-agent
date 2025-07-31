import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface ReportItem {
  'report' : string,
  'proposalTitle' : string,
  'proposalID' : string,
}
export interface Worker {
  'balance' : ActorMethod<[], bigint>,
  'get_full_reports' : ActorMethod<[Array<string>], Array<ReportItem>>,
  'get_report' : ActorMethod<[string], ReportItem>,
  'get_reports_list' : ActorMethod<[bigint, bigint], Array<string>>,
  'save_report' : ActorMethod<[string, string, string], bigint>,
}
export interface _SERVICE extends Worker {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
