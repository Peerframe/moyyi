import { useEffect, useRef } from "react";

/** Local help only; these instructions are never appended to a model request. */
export function UsageGuide({
  onClose,
  onSettings,
  onMaintenance,
}: {
  onClose(): void;
  onSettings(): void;
  onMaintenance(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog usage-guide"
      aria-labelledby="usage-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="usage-heading">开始使用 moyyi</h2>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="panel-note">
        先选择工作目录。每个新会话和重新打开的会话都从只读开始；选择目录不会发送文件。
        发送任务后，模型按需调用工具读取，读取结果会发送给你选择的模型服务。
      </p>
      <div className="guide-workflows">
        <section>
          <h3>读取网页与核对来源</h3>
          <ol>
            <li>任务空闲时打开「网页访问」，填写确切 HTTPS 来源并选择 DNS；在系统窗口确认。</li>
            <li>在任务中提供完整网页 URL 与问题。每次 GET 先核对目标和预览，再批准或拒绝。</li>
            <li>
              展开「网页来源」，对照实际返回正文、URL、HTTP 状态、记录时间和截断标记核对回答。
            </li>
          </ol>
          <p>
            默认不联网。Cloudflare DoH 会向 Cloudflare
            发送主机名；网页正文会进入所选模型的上下文。不登录、不执行网页脚本、不自动跟随跳转，也不自动事实核验。打开历史来源不会重新请求网页。
          </p>
        </section>
        <section>
          <h3>读取项目</h3>
          <ol>
            <li>选择项目目录，说明你想理解的问题和范围。</li>
            <li>发送后查看实际读取的文件与回答中的来源。</li>
            <li>对重要结论核对原文。任务正常结束不代表回答一定正确。</li>
          </ol>
          <p>只读任务不需要开启文件修改或命令检查。</p>
        </section>
        <section>
          <h3>根据文档生成报告</h3>
          <ol>
            <li>把材料放在同一工作目录，点击「选择材料」。</li>
            <li>点击「选择报告位置」，选择尚不存在的 .md、.txt、.csv 或 .json 文件。</li>
            <li>说明报告要求，发送任务，审阅创建预览后决定是否批准。</li>
            <li>从「报告成果」打开或在访达中定位实际文件，核对内容和来源。</li>
          </ol>
          <p>
            支持 PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP 正文；扫描件 OCR、公式计算和版式还原尚不支持。
          </p>
        </section>
        <section>
          <h3>修改、检查与撤销</h3>
          <ol>
            <li>在「会话权限」分别开启需要的文件修改、Node 命令检查权限。</li>
            <li>提出修改目标。每次操作都先看预览，再批准或拒绝。</li>
            <li>检查在只读、无网络的原生沙箱中运行；退出码 0 仍需结合实际结果判断。</li>
            <li>在「操作记录」核对当前文件，或点「准备撤销」填写草稿，再发送并审批。</li>
          </ol>
          <p>
            多次修改按快照逆序撤销。停止会保留已完成的修改；重开只恢复记录，不重放动作。结果未知时先核对，保护性锁不会因重新授权而解除。
          </p>
        </section>
      </div>
      <p className="panel-note">
        请求上限和时限显示在会话顶部。多步骤任务可在模型设置中调整；达到上限后本轮停止，
        重新发送是新一轮，会再次使用模型额度。保存设置、查看记录和文件核对不调用模型。
      </p>
      <div className="guide-actions">
        <button type="button" onClick={onSettings}>
          打开模型设置
        </button>
        <button type="button" onClick={onMaintenance}>
          备份与回退
        </button>
      </div>
    </dialog>
  );
}
