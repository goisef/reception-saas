package jp.receptionsaas.terminal;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * 受付端末のホスト Activity。
 *
 * 受付画面そのものはサーバーから読み込む (capacitor.config.ts の server.url)。
 * ここに業務ロジックを持たせない。設計原則 P-1「端末をアップデートしなくても
 * 仕様変更できる」を守るため、アプリ側の責務は端末としての振る舞いだけに絞る。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 据え置きの受付端末が消灯すると、来店客は「壊れている」と判断して
        // そのまま帰ってしまう。表示中は画面を消さない。
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
