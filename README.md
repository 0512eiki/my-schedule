# My schedule

柔道のプライベートレッスン（代金・回数券・振替・内容の記録）と、柔道の予定（練習・大会・審判など）をまとめて管理するアプリ。コーチ専用。

- 公開: https://0512eiki.github.io/my-schedule/
- データ: Supabase（柔道ノートと同じプロジェクト。表は `ms_items` / `ms_push_subs`、コーチ本人の行だけ読み書きできる）
- ログイン: 柔道ノートのコーチの ID とパスワード
- 通知: 前の日の夜（初期 21:00）に翌日の予定（Edge Function `my-schedule-push`、30分ごとの Cron）
