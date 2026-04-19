import json
import sys
import traceback
import io
from contextlib import redirect_stdout, redirect_stderr

from genetic_algorithm import run_ga_with_raw


def main():
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8')

        payload = json.load(sys.stdin)
        raw_data = payload.get('raw_data')
        if not raw_data:
            raise ValueError("Missing 'raw_data' in payload")

        pop_size  = int(payload.get('pop_size', 20))
        max_gen   = int(payload.get('max_gen', 200))
        file_name = payload.get('file_name', 'supabase_runtime.json')

        # tuanhoc de Python tu loc phan_cong da het so_tuan_can_hoc.
        # Server da loc truoc bang week-based check; day la lop bao ve thu 2.
        tuanhoc_raw = payload.get('tuanhoc')
        tuanhoc = int(tuanhoc_raw) if tuanhoc_raw is not None else None

        # Chan toan bo print tu thuat toan de stdout chi con JSON response.
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = run_ga_with_raw(
                raw_data=raw_data,
                file=file_name,
                pop_size=pop_size,
                max_gen=max_gen,
                tuanhoc=tuanhoc,
            )
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=True))
    except Exception as exc:
        print(
            json.dumps(
                {
                    'ok': False,
                    'error': str(exc),
                    'traceback': traceback.format_exc(),
                },
                ensure_ascii=True,
            )
        )
        sys.exit(1)


if __name__ == '__main__':
    main()
