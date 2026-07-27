import type { Translator } from '../i18n';

type StartupScreenProps = {
  t: Translator;
};

export default function StartupScreen({ t }: StartupScreenProps) {
  return (
    <main className="startup-screen" aria-busy="true" aria-live="polite">
      <section className="startup-card" role="status">
        <div className="startup-brand" aria-hidden="true">
          <div className="startup-logo">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Configra</strong>
            <span>{t('startupProductLabel')}</span>
          </div>
        </div>

        <div className="startup-copy">
          <h1>{t('startupTitle')}</h1>
          <p>{t('startupLoadingProject')}</p>
        </div>

        <div className="startup-progress" aria-hidden="true">
          <span />
        </div>
      </section>
    </main>
  );
}
