
/* IMPORT */

import * as _ from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';
import Config from './config';
import Consts from './consts';
import Document from './todo/document';
import ItemFile from './views/items/item';
import ItemTodo from './views/items/todo';
import StatusbarTimer from './statusbars/timer';
import Utils from './utils';
import ViewEmbedded from './views/embedded';
import ViewFiles from './views/files';

/* CALL TODOS METHOD */

const callTodosMethodOptions = {
  checkValidity: false,
  filter: _.identity,
  method: undefined,
  args: [],
  errors: {
    invalid: 'Only todos can perform this action',
    filtered: 'This todo cannot perform this action'
  }
};

async function callTodosMethod ( options? ) {

  options = _.isString ( options ) ? { method: options } : options;
  options = _.merge ( {}, callTodosMethodOptions, options );

  const textEditor = vscode.window.activeTextEditor,
        doc = new Document ( textEditor );

  if ( !doc.isSupported () ) return;

  const lines = _.uniq ( _.flatten ( textEditor.selections.map ( selection => _.range ( selection.start.line, selection.end.line + 1 ) ) ) ),
        todos = _.filter ( lines.map ( line => doc.getTodoAt ( line, options.checkValidity ) ) );

  if ( todos.length !== lines.length ) vscode.window.showErrorMessage ( options.errors.invalid );

  if ( !todos.length ) return;

  const todosFiltered = todos.filter ( options.filter );

  if ( todosFiltered.length !== todos.length ) vscode.window.showErrorMessage ( options.errors.filtered );

  if ( !todosFiltered.length ) return;

  todosFiltered.map ( todo => todo[options.method]( ...options.args ) );

  const edits = _.filter ( _.flattenDeep ( todosFiltered.map ( todo => todo['makeEdit']() ) ) );

  if ( !edits.length ) return;

  const selectionsTagIndexes = textEditor.selections.map ( selection => {
    const line = textEditor.document.lineAt ( selection.start.line );
    return line.text.indexOf ( Consts.symbols.tag );
  });

  await Utils.editor.edits.apply ( textEditor, edits );

  textEditor.selections = textEditor.selections.map ( ( selection, index ) => { // Putting the cursors before first new tag
    if ( selectionsTagIndexes[index] >= 0 ) return selection;
    const line = textEditor.document.lineAt ( selection.start.line );
    if ( selection.start.character !== line.text.length ) return selection;
    const tagIndex = line.text.indexOf ( Consts.symbols.tag );
    if ( tagIndex < 0 ) return selection;
    const position = new vscode.Position ( selection.start.line, tagIndex );
    return new vscode.Selection ( position, position );
  });

}

/* COMMANDS */

async function open ( filePath?: string, lineNumber?: number ) {

  filePath = _.isString ( filePath ) ? filePath : undefined;
  lineNumber = _.isNumber ( lineNumber ) ? lineNumber : undefined;

  if ( filePath ) {

    return Utils.file.open ( filePath, true, lineNumber );

  } else {

    const config = Config.get (),
          {activeTextEditor} = vscode.window,
          editorPath = activeTextEditor && activeTextEditor.document.uri.fsPath,
          rootPath = Utils.folder.getRootPath ( editorPath );

    if ( !rootPath ) return vscode.window.showErrorMessage ( 'You have to open a project before being able to open its todo file' );

    const projectPath = ( ( await Utils.folder.getWrapperPathOf ( rootPath, editorPath || rootPath, config.file.name ) ) || rootPath ) as string,
          todo = Utils.todo.get ( projectPath );

    if ( !_.isUndefined ( todo ) ) { // Open

      return Utils.file.open ( todo.path, true, lineNumber );

    } else { // Create

      const defaultPath = path.join ( projectPath, config.file.name );

      await Utils.file.make ( defaultPath, config.file.defaultContent );

      return Utils.file.open ( defaultPath );

    }

  }

}

async function openEmbedded () {

  await Utils.embedded.initProvider ();

  const config = Config.get (),
        todos = await Utils.embedded.provider.get ( undefined, config.embedded.file.groupByRoot, config.embedded.file.groupByType, config.embedded.file.groupByFile ),
        content = Utils.embedded.provider.renderTodos ( todos );

  if ( !content ) return vscode.window.showInformationMessage ( 'No embedded todos found' );

  Utils.editor.open ( content );

}

function toggleBox () {

  return callTodosMethod ( 'toggleBox' );

}

function toggleDone () {

  return callTodosMethod ( 'toggleDone' );

}

function toggleCancelled () {

  return callTodosMethod ( 'toggleCancelled' );

}

function toggleStart () {

  return callTodosMethod ({
    checkValidity: true,
    filter: todo => todo.isBox (),
    method: 'toggleStart',
    errors: {
      invalid: 'Only todos can be started',
      filtered: 'Only not done/cancelled todos can be started'
    }
  });

}

function toggleTimer () {

  Consts.timer = !Consts.timer;

  StatusbarTimer.updateVisibility ();
  StatusbarTimer.updateTimer ();

  vscode.window.showInformationMessage ( `Timer ${Consts.timer ? 'enabled' : 'disabled'}` );

}

function archive () {

  const textEditor = vscode.window.activeTextEditor,
        doc = new Document ( textEditor );

  if ( !doc.isSupported () ) return;

  Utils.archive.run ( doc );

}

function exportHtml () {

  const textEditor = vscode.window.activeTextEditor;
  const doc = new Document ( textEditor.document );
               
  let content = '<html><head></head><body>\n';
  let obj = doc.getLines();

  let lines = obj[0].textEditor._documentData._lines;

  for (let i = 0; i < lines.length; i++) {

    let line: string = lines[i];
    let fmtd: any = false;
    let idx: number;

    if ( Consts.regexes.comment.test( line ) ) {
      continue;
    }
    else if ( Consts.regexes.project.test( line ) ) {

      fmtd = true;
      line = '<font color="' + Consts.colors.project + '">\n' + line;
    }
    else {

      if ( Consts.regexes.todoCancelled.test( line ) ) {
        fmtd = true;
        line = '<font color="#f92672">\n' + line;
      }
      else if ( Consts.regexes.todoDone.test( line ) ) {
        fmtd = true;
        line = '<font color="#a6e25b">\n' + line;
      }

      //Consts.colors.tags.background[0]

      let regexResult = Consts.regexes.tagCreated.exec( line );
      if (regexResult) {
        idx = line.indexOf(')', regexResult.index + 1) + 1;
        if (idx === 0) {
          idx = line.length;
        }
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (regexResult.index < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        line = line.substring(0, regexResult.index + 1) + (fmtd === true ? '</font>' : '') + 
              '<font style="background-color:' + Consts.colors.tag + '">\n' + 
              line.substring(regexResult.index, idx) + '</font>' +  (idx !== line.length ? line.substring(idx) : '');
        
        if (fmtd === true) {
          fmtd = 1;
        };
      }

      regexResult = Consts.regexes.tagStarted.exec( line );
      if (regexResult) {
        idx = line.indexOf(')', regexResult.index + 1) + 1;
        if (idx === 0) {
          idx = line.length;
        }
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (regexResult.index < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        line = line.substring(0, regexResult.index + 1) + (fmtd === true ? '</font>' : '') + 
              '<font style="background-color:' + Consts.colors.tag + '">\n' + 
              line.substring(regexResult.index, idx) + '</font>' +  (idx !== line.length ? line.substring(idx) : '');
        
        if (fmtd === true) {
          fmtd = 1;
        }
      }

      regexResult = Consts.regexes.tagFinished.exec( line );
      if (regexResult) {
        idx = line.indexOf(')', regexResult.index + 1) + 1;
        if (idx === 0) {
          idx = line.length;
        }
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (regexResult.index < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        line = line.substring(0, regexResult.index + 1) + (fmtd === true ? '</font>' : '') + 
              '<font style="background-color:' + Consts.colors.tag + '">\n' + 
              line.substring(regexResult.index, idx) + '</font>' +  (idx !== line.length ? line.substring(idx) : '');
        
        if (fmtd === true) {
          fmtd = 1;
        }
      }
      
      regexResult = Consts.regexes.tagElapsed.exec( line );
      if (regexResult) {
        idx = line.indexOf(')', regexResult.index + 1) + 1;
        if (idx === 0) {
          idx = line.length;
        }
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (regexResult.index < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        line = line.substring(0, regexResult.index + 1) + (fmtd === true ? '</font>' : '') + 
              '<font style="background-color:' + Consts.colors.tag + '">\n' + 
              line.substring(regexResult.index, idx) + '</font>' +  (idx !== line.length ? line.substring(idx) : '');
        
        if (fmtd === true) {
          fmtd = 1;
        }
      }

      regexResult = Consts.regexes.tagEstimate.exec( line );
      if (regexResult) {
        idx = line.indexOf(' ', regexResult.index);
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (regexResult.index < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        if (idx !== -1) {
          line = line.substring(0, regexResult.index) + (fmtd === true ? '</font>' : '') + 
                '<font style="background-color:' + Consts.colors.tag + '">' + 
                line.substring(regexResult.index - 1, idx) + '</font>\n' + line.substring(idx);
        }
        else {
          line = line.substring(0, regexResult.index) + (fmtd === true ? '</font>' : '') + 
                '<font style="background-color:' + Consts.colors.tag + '">' + 
                line.substring(regexResult.index - 1) + '</font>\n';
        }
        if (fmtd === true) {
          fmtd = 1;
        }
      }

      // This regex does not work, there is a timing issue
      //regexResult = Consts.regexes.tagEstimate.exec( line );
      //regexResult = Consts.regexes.tagSpecialNormal.exec( line );
      let specialTagExists = line.indexOf('@low');
      if (specialTagExists === -1) {
        specialTagExists = line.indexOf('@medium');
      }
      if (specialTagExists === -1) {
        specialTagExists = line.indexOf('@high');
      }
      if (specialTagExists === -1) {
        specialTagExists =  line.indexOf('@critical');
      }
      if (specialTagExists !== -1) {
        let tagIdx = 0;
        let tagNames = Consts.tags.names;
        idx = line.indexOf(' ', specialTagExists + 1);
        if (idx === -1) {
          idx = line.length;
        }
        let tagName;
        if (idx !== -1) {
          tagName = line.substring(specialTagExists + 1, idx).trim();
        }
        else {
          tagName = line.substring(specialTagExists + 1).trim();
        }
        for (let i = 0; i < tagNames.length; i++) {
          
          console.log(tagName + '=' + tagNames[i]);
          if (tagName === tagNames[i]) {
            tagIdx = i;
            break;
          }
        }
        if (fmtd === 1) {
          let idx2 = line.indexOf('</font>');
          if (specialTagExists < idx2) {
            fmtd = true;
            line = line.replace('</font>', '');
          }
        }
        line = line.substring(0, specialTagExists) + (fmtd === true ? '</font>' : '') + 
                '<font style="background-color:' + Consts.colors.tags.background[tagIdx] + '">\n' + 
                line.substring(specialTagExists, idx) + '</font>' +  line.substring(idx);
        if (fmtd === true) {
          fmtd = 1;
        }
      }
    }

    content += line;

    if (fmtd === true) {
      content += '\n</font>';
    }
    content += '\n<br>\n';
  }

  content += '</body></html>\n';
  content = content.replace(/  /g, '&nbsp;&nbsp;');
  
  Utils.editor.open ( content );
}

/* VIEW */

function viewOpenFile ( file: ItemFile ) {

  Utils.file.open ( file.resourceUri.fsPath, true, 0 );

}

function viewRevealTodo ( todo: ItemTodo ) {

  if ( todo.obj.todo ) {

    const startIndex = todo.obj.rawLine.indexOf ( todo.obj.todo ),
          endIndex = startIndex + todo.obj.todo.length;

    Utils.file.open ( todo.obj.filePath, true, todo.obj.lineNr, startIndex, endIndex );

  } else {

    Utils.file.open ( todo.obj.filePath, true, todo.obj.lineNr );

  }

}

/* VIEW FILE */

function viewFilesOpen () {
  open ();
}

function viewFilesCollapse () {
  ViewFiles.expanded = false;
  vscode.commands.executeCommand ( 'setContext', 'todo-files-expanded', false );
  ViewFiles.refresh ( true );
}

function viewFilesExpand () {
  ViewFiles.expanded = true;
  vscode.commands.executeCommand ( 'setContext', 'todo-files-expanded', true );
  ViewFiles.refresh ( true );
}

/* VIEW EMBEDDED */

function viewEmbeddedCollapse () {
  ViewEmbedded.expanded = false;
  vscode.commands.executeCommand ( 'setContext', 'todo-embedded-expanded', false );
  ViewEmbedded.refresh ( true );
}

function viewEmbeddedExpand () {
  ViewEmbedded.expanded = true;
  vscode.commands.executeCommand ( 'setContext', 'todo-embedded-expanded', true );
  ViewEmbedded.refresh ( true );
}

async function viewEmbeddedFilter () {

  const filter = await vscode.window.showInputBox ({ placeHolder: 'Filter string...' });

  if ( !filter || ViewEmbedded.filter === filter ) return;

  ViewEmbedded.filter = filter;
  vscode.commands.executeCommand ( 'setContext', 'todo-embedded-filtered', true );
  ViewEmbedded.refresh ();

}

function viewEmbeddedClearFilter () {
  ViewEmbedded.filter = false;
  vscode.commands.executeCommand ( 'setContext', 'todo-embedded-filtered', false );
  ViewEmbedded.refresh ();
}

/* EXPORT */

export {open, openEmbedded, toggleBox, toggleDone, toggleCancelled, toggleStart, toggleTimer, archive, exportHtml, viewOpenFile, viewRevealTodo, viewFilesOpen, viewFilesCollapse, viewFilesExpand, viewEmbeddedCollapse, viewEmbeddedExpand, viewEmbeddedFilter, viewEmbeddedClearFilter};
export {toggleBox as editorToggleBox, toggleDone as editorToggleDone, toggleCancelled as editorToggleCancelled, toggleStart as editorToggleStart, archive as editorArchive}
