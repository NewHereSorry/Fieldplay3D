"""Deploy fieldplay3d to Cloudflare Pages (project 'fieldplay3d' → https://fieldplay3d.pages.dev).
    python tools/deploy.py
Stages index.html, css/, js/, tests/ (minus the probe page) into a temp dir and runs
`npx wrangler pages deploy`. Needs a one-time `npx wrangler login`; Node lives in the WinGet folder.
"""
import os, shutil, subprocess, sys, tempfile, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = glob.glob(os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*\node-*-win-x64'))

def main():
    if NODE: os.environ['PATH'] = NODE[0] + os.pathsep + os.environ['PATH']
    stage = tempfile.mkdtemp(prefix='fp3d_deploy_')
    try:
        shutil.copy(os.path.join(ROOT, 'index.html'), stage)
        for d in ('css', 'js', 'tests'):
            shutil.copytree(os.path.join(ROOT, d), os.path.join(stage, d))
        probe = os.path.join(stage, 'tests', 'probe.html')
        if os.path.exists(probe): os.remove(probe)
        cmd = ['npx', '-y', 'wrangler@latest', 'pages', 'deploy', stage, '--project-name', 'fieldplay3d', '--branch', 'main', '--commit-dirty=true']
        r = subprocess.run(cmd, shell=True)
        sys.exit(r.returncode)
    finally:
        shutil.rmtree(stage, ignore_errors=True)

if __name__ == '__main__':
    main()
