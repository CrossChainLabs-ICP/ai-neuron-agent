export const idlFactory = ({ IDL }) => {
  const ReportItem = IDL.Record({
    'report' : IDL.Text,
    'proposalTitle' : IDL.Text,
    'proposalID' : IDL.Text,
  });
  const Worker = IDL.Service({
    'balance' : IDL.Func([], [IDL.Nat], ['query']),
    'get_full_reports' : IDL.Func(
        [IDL.Vec(IDL.Text)],
        [IDL.Vec(ReportItem)],
        ['query'],
      ),
    'get_report' : IDL.Func([IDL.Text], [ReportItem], ['query']),
    'get_reports_list' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Vec(IDL.Text)],
        ['query'],
      ),
    'save_report' : IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Nat], []),
  });
  return Worker;
};
export const init = ({ IDL }) => { return []; };
