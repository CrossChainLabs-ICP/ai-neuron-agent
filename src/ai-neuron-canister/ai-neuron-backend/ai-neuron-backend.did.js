export const idlFactory = ({ IDL }) => {
  const ReportStorage = IDL.Service({
    'getReport' : IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ['query']),
    'listReports' : IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
    'saveReport' : IDL.Func([IDL.Text, IDL.Text], [IDL.Opt(IDL.Text)], []),
  });
  return ReportStorage;
};
export const init = ({ IDL }) => { return []; };
