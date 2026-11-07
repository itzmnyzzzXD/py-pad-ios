'use strict';
const ExtensionManager = {
  catalog: [
    {id:'json-tools',badge:'JSON',name:'JSON Tools',description:'Validate JSON files and inspect a formatted result in the terminal.',types:'.json'},
    {id:'markdown-preview',badge:'MD',name:'Markdown Preview',description:'Render headings, emphasis, links and fenced code in the Preview panel.',types:'.md · .markdown'},
    {id:'csv-grid',badge:'CSV',name:'CSV Grid',description:'Open comma-separated data as a scrollable table without changing the source file.',types:'.csv'}
  ],
  read() {
    try { const value=JSON.parse(localStorage.getItem('pypad.extensions')||'{}'); return Object.fromEntries(this.catalog.map(x=>[x.id,value[x.id]!==false])); }
    catch (_) { return Object.fromEntries(this.catalog.map(x=>[x.id,true])); }
  },
  enabled(id) { return this.read()[id]!==false; },
  toggle(id) {
    const value=this.read(); if(!(id in value))return;
    value[id]=!value[id]; localStorage.setItem('pypad.extensions',JSON.stringify(value));
    toast((value[id]?'Enabled ':'Disabled ')+(this.catalog.find(x=>x.id===id)?.name||'extension'));
  },
  escape(value) { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  htmlPage(title,body) {
    const style='body{margin:0;padding:24px;background:#0b0e14;color:#e6e9ef;font:14px -apple-system,system-ui,sans-serif}main{max-width:1100px;margin:auto}h1{font-size:24px;margin:0 0 18px}'+
      'table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace;background:#141a26}th,td{padding:9px 11px;border:1px solid #293346;text-align:left;vertical-align:top;white-space:pre-wrap}'+
      'th{background:#202a3b;color:#ffbd68;position:sticky;top:0}tr:nth-child(even){background:#101722}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#141a26;border:1px solid #293346;border-radius:12px;padding:16px}'+
      'a{color:#72c9ff}blockquote{border-left:3px solid #ffb454;margin-left:0;padding-left:14px;color:#a8b3c4}code{background:#202a3b;padding:2px 5px;border-radius:4px}';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'</style></head><body><main><h1>'+this.escape(title)+'</h1>'+body+'</main></body></html>';
  },
  markdown(source) {
    let text=this.escape(source),blocks=[];
    text=text.replace(/```([\w+-]*)\n([\s\S]*?)```/g,(_,lang,code)=>{const token='%%BLOCK'+blocks.length+'%%';blocks.push('<pre><code>'+code+'</code></pre>');return token;});
    text=text.replace(/^###### (.+)$/gm,'<h6>$1</h6>').replace(/^##### (.+)$/gm,'<h5>$1</h5>').replace(/^#### (.+)$/gm,'<h4>$1</h4>')
      .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
      .replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>').replace(/^---+$/gm,'<hr>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a rel="noopener" href="$2">$1</a>');
    text=text.split(/\n{2,}/).map(block=>/^%%BLOCK\d+%%$/.test(block)||/^<h[1-6]|^<blockquote|^<hr/.test(block)?block:'<p>'+block.replace(/\n/g,'<br>')+'</p>').join('\n');
    return text.replace(/%%BLOCK(\d+)%%/g,(_,i)=>blocks[+i]);
  },
  parseCSV(input) {
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<input.length;i++){const c=input[i];
      if(c==='"'&&quoted&&input[i+1]==='"'){cell+='"';i++;}
      else if(c==='"')quoted=!quoted;
      else if(c===','&&!quoted){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    row.push(cell);if(row.some(v=>v!==''))rows.push(row);
    return rows.slice(0,1001).map(r=>r.slice(0,80));
  },
  async runFile(path) {
    const ext=Path.ext(path),source=WS.files[path]||'';
    if(ext==='json'&&this.enabled('json-tools')){
      UI.showOut('term');Con.cmd('$ json '+path);
      try{const value=JSON.parse(source);Con.ok('Valid JSON · '+(Array.isArray(value)?value.length+' items':typeof value));Con.out(JSON.stringify(value,null,2));}
      catch(error){Con.err('Invalid JSON: '+error.message);}
      return true;
    }
    if((ext==='md'||ext==='markdown')&&this.enabled('markdown-preview')){
      PV._show(this.htmlPage(Path.base(path),this.markdown(source)),path+' · Markdown preview');UI.showOut('prev');return true;
    }
    if(ext==='csv'&&this.enabled('csv-grid')){
      const rows=this.parseCSV(source);
      if(!rows.length){Con.warn('CSV file is empty.');UI.showOut('term');return true;}
      const head=rows[0],body='<div style="overflow:auto;max-height:85vh"><table><thead><tr>'+head.map(x=>'<th>'+this.escape(x)+'</th>').join('')+'</tr></thead><tbody>'+
        rows.slice(1).map(r=>'<tr>'+head.map((_,i)=>'<td>'+this.escape(r[i]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
        '<p style="color:#8794a8">Showing '+Math.max(0,rows.length-1)+' data rows · source file unchanged</p>';
      PV._show(this.htmlPage(Path.base(path),body),path+' · CSV grid');UI.showOut('prev');return true;
    }
    return false;
  }
};
