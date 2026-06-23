// Slimmed down: only export core (Complex/BaseStore/observer).
// The original marginalia file also imports './style/index.less' and exports './components' (antd CRUD/form/picker etc.),
// fangtu doesn't use antd, so those weren't copied.
export * from './core';
