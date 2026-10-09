import { useParams, Link } from 'react-router-dom';
import { useBranding } from '../../context/BrandingContext';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/shared';
import { Button } from '../../components/ui/Button';
import { IconArrowLeft } from '../../components/ui/Icons';

const PAGES: Record<string, { title: string; text: (b: ReturnType<typeof useBranding>['branding']) => string }> = {
  terms: { title: 'Terms and conditions', text: (b) => b?.termsAndConditions || '' },
  privacy: { title: 'Privacy policy', text: (b) => b?.privacyPolicy || '' },
  refund: { title: 'Refund policy', text: (b) => b?.refundPolicy || '' },
};

export function Legal() {
  const { slug } = useParams<{ slug: string }>();
  const { branding } = useBranding();
  const page = slug ? PAGES[slug] : undefined;

  if (!page) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <p className="text-sm text-slate-500">Page not found.</p>
          <Link to="/">
            <Button variant="secondary" size="sm" className="mt-3">
              Back
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const text = page.text(branding);

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title={page.title}
        action={
          <Link to="/">
            <Button variant="secondary" size="sm">
              <IconArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
        }
      />
      <Card>
        {text ? (
          <div className="prose prose-sm max-w-none whitespace-pre-line text-slate-700">{text}</div>
        ) : (
          <p className="text-sm text-slate-400">This document has not been published yet.</p>
        )}
      </Card>
    </div>
  );
}
