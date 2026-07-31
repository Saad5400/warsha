const e=`/home/pyodide/project`;let t=null,n=null,r=null,i=!1,a=`https://cdn.jsdelivr.net/pyodide/v314.0.3/full/`,o=null,s=null;const c=new TextDecoder,l=new TextDecoder,u=new TextDecoder;function d(){for(Atomics.store(o,0,0),self.postMessage({type:`stdin-request`});Atomics.load(o,0)===0;)Atomics.wait(o,0,0,250);let e=Atomics.load(o,0);if(Atomics.store(o,0,0),e===2)return;let t=Atomics.load(o,1);return c.decode(s.slice(0,t))+`
`}let f=0,p=!1;function m(e,t,n){return p?n.length:(f+=n.length,f>2097152?(p=!0,self.postMessage({type:`stderr`,text:`
[Warsha: output limit of 2 MiB reached; further output is discarded. Press Stop.]
`}),n.length):(self.postMessage({type:e,text:t.decode(n,{stream:!0})}),n.length))}const h=`Downloading Python (11 MB, one-time)...`;let g=0,_=0,v=0;function y(e){let t=performance.now();!e&&t-v<100||(v=t,self.postMessage({type:`progress`,phase:`download`,message:h,loaded:g,total:Math.max(1215e4,_,g)}))}function b(){let e=self.fetch.bind(self);return self.fetch=async(t,n)=>{let r=await e(t,n);try{if(!(typeof t==`string`?t:t&&t.url?t.url:String(t)).startsWith(a)||!r.ok||!r.body)return r;let e=Number(r.headers.get(`content-length`)||0);e>0&&(_+=e);let n=r.body.getReader(),i=new ReadableStream({async pull(e){let{done:t,value:r}=await n.read();if(t){y(!0),e.close();return}g+=r.byteLength,y(!1),e.enqueue(r)},cancel:e=>n.cancel(e)});return new Response(i,{status:r.status,statusText:r.statusText,headers:r.headers})}catch{return r}},()=>{self.fetch=e}}async function x(){let o=performance.now();self.postMessage({type:`progress`,phase:`download`,message:h});let s=b();try{let{loadPyodide:e}=await import(a+`pyodide.mjs`);t=await e({indexURL:a})}finally{s()}self.postMessage({type:`progress`,phase:`boot`,message:`Starting Python...`}),t.setStdout({isatty:i,write:e=>m(`stdout`,l,e)}),t.setStderr({isatty:i,write:e=>m(`stderr`,u,e)}),t.setStdin({isatty:i,stdin:d}),t.FS.mkdirTree(e),t.runPython(S),n=t.globals.get(`_warsha_run`),r=t.globals.get(`_warsha_reset_fs`),self.postMessage({type:`ready`,version:t.version,bootMs:Math.round(performance.now()-o)})}const S=String.raw`
import os, shutil, sys, traceback

_WARSHA_PROJ = ${JSON.stringify(e)}


def _warsha_reset_fs():
    os.chdir("/")
    shutil.rmtree(_WARSHA_PROJ, ignore_errors=True)
    os.makedirs(_WARSHA_PROJ, exist_ok=True)


def _warsha_run(entry):
    proj = _WARSHA_PROJ
    if proj not in sys.path:
        sys.path.insert(0, proj)
    os.chdir(proj)

    # Drop user modules imported by an earlier run, so editing a helper file
    # takes effect instead of resolving to the cached module.
    for name in [
        n for n, m in list(sys.modules.items())
        if getattr(m, "__file__", None) and str(m.__file__).startswith(proj)
    ]:
        del sys.modules[name]

    with open(os.path.join(proj, entry)) as f:
        src = f.read()

    # Relative filename so tracebacks read "helpers/shapes.py", and __main__
    # semantics so "if __name__ == '__main__'" fires.
    g = {"__name__": "__main__", "__file__": entry, "__builtins__": __builtins__}

    status = 0
    code = None
    try:
        # Compiled outside the exec try-block: a SyntaxError here is raised in
        # *this* frame and has no useful traceback, so it needs the
        # exception-only rendering, which is also what plain "python main.py"
        # prints for a file that fails to parse.
        code = compile(src, entry, "exec")
    except SyntaxError as e:
        sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
        status = 1

    if code is not None:
        try:
            exec(code, g)
        except SystemExit as e:
            c = e.code
            if c is None:
                status = 0
            elif isinstance(c, int):
                status = c
            else:
                sys.stderr.write(str(c) + "\n")
                status = 1
        except BaseException as e:
            # Drop this runner's own exec() frame so the student sees only their
            # own files, and strip the FS prefix so helper frames read
            # "helpers/shapes.py" not "/home/pyodide/project/helpers/shapes.py".
            tb = e.__traceback__.tb_next if e.__traceback__ else None
            text = "".join(traceback.format_exception(type(e), e, tb or e.__traceback__))
            sys.stderr.write(text.replace(proj + "/", ""))
            status = 1

    sys.stdout.flush()
    sys.stderr.flush()
    return status
`;function C(n){for(let[r,i]of Object.entries(n)){let n=`${e}/${r}`,a=n.slice(0,n.lastIndexOf(`/`));t.FS.mkdirTree(a),t.FS.writeFile(n,i,{encoding:`utf8`})}}self.onmessage=e=>{let t=e.data;if(t.type===`init`){o=new Int32Array(t.sab,0,2),s=new Uint8Array(t.sab,8),t.isatty===!0&&(i=!0),typeof t.indexURL==`string`&&t.indexURL&&(a=t.indexURL),x().catch(e=>self.postMessage({type:`fatal`,text:String(e&&e.stack||e),duringBoot:!0}));return}if(t.type===`run`){f=0,p=!1;try{r(),C(t.files);let e=performance.now(),i=n(t.entry);self.postMessage({type:`done`,code:Number(i)|0,ms:Math.round(performance.now()-e)})}catch(e){self.postMessage({type:`fatal`,text:String(e&&e.stack||e)})}}};