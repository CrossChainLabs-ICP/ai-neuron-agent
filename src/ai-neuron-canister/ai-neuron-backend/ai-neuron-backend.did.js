export const idlFactory = ({ IDL }) => {
  const ReportsStorage = IDL.Service({
    'autoscale' : IDL.Func([], [IDL.Nat], []),
    'balance' : IDL.Func([], [IDL.Nat], ['query']),
    'delete_workers' : IDL.Func([], [], []),
    'get_workers' : IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    'saveReport' : IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Bool], []),
    'upgrade' : IDL.Func([IDL.Vec(IDL.Nat8)], [], []),
  });
  return ReportsStorage;
};
export const init = ({ IDL }) => { return []; };
