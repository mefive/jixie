import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco shares one worker registry across editors. Register every supported language once so
// lazy editor imports cannot replace a TypeScript or JSON worker with the default editor worker.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      case 'json':
        return new jsonWorker();
      default:
        return new editorWorker();
    }
  },
};
loader.config({ monaco });
