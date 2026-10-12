/**
 * Zertifikatsangaben für Anzeige und Protokoll – und ehrlich eingeordnet:
 * „qualifiziert" heißt es nur, wenn das Zertifikat selbst es über die
 * QC-Statements (ETSI EN 319 412-5) erklärt, inklusive sicherer
 * Signaturerstellungseinheit (QSCD). Maßgeblich bleibt die EU-Vertrauensliste.
 */
import { X509Certificate } from 'node:crypto';
import { parseCertificate } from './cms';

export interface CertInfo {
	/** Name (CN, sonst O) */
	name: string;
	organization: string;
	subject: string;
	issuerName: string;
	issuer: string;
	serial: string;
	notBefore: string;
	notAfter: string;
	/** SHA-256 des Zertifikats, hexadezimal */
	fingerprint: string;
	selfSigned: boolean;
	/** QC-Statements: qualifiziertes Zertifikat, Schlüssel in QSCD, Art (Siegel/Signatur) */
	qc: { compliance: boolean; sscd: boolean; type: 'siegel' | 'signatur' | 'web' | null };
}

export type Qualification = 'qualifiziert' | 'qualifiziertes-zertifikat' | 'ausgestellt' | 'selbst';

export const QUALIFICATION_LABELS: Record<Qualification, string> = {
	qualifiziert: 'Qualifiziert laut Zertifikat (QSCD)',
	'qualifiziertes-zertifikat': 'Qualifiziertes Zertifikat, ohne QSCD-Angabe – nicht qualifiziert',
	ausgestellt: 'Zertifikat eines Ausstellers – nicht qualifiziert',
	selbst: 'Eigenes, selbst ausgestelltes Zertifikat – nicht qualifiziert'
};

const field = (dn: string, key: string) =>
	dn
		.split('\n')
		.find((l) => l.startsWith(`${key}=`))
		?.slice(key.length + 1) ?? '';

/** OID-Codierungen der QC-Statements (0.4.0.1862.1.x) */
const QC = {
	compliance: Buffer.from('060604008e460101', 'hex'),
	sscd: Buffer.from('060604008e460104', 'hex'),
	eseal: Buffer.from('060704008e46010602', 'hex'),
	esign: Buffer.from('060704008e46010601', 'hex'),
	web: Buffer.from('060704008e46010603', 'hex')
};

export function certInfo(der: Buffer): CertInfo {
	const x = new X509Certificate(der);
	let selfSigned = false;
	try {
		selfSigned = x.subject === x.issuer && x.verify(x.publicKey);
	} catch {
		/* bleibt false */
	}
	const qc: CertInfo['qc'] = { compliance: false, sscd: false, type: null };
	try {
		const ext = parseCertificate(der).extensions?.find((e) => e.extnID === '1.3.6.1.5.5.7.1.3');
		if (ext) {
			const value = Buffer.from(ext.extnValue.valueBlock.valueHexView);
			qc.compliance = value.includes(QC.compliance);
			qc.sscd = value.includes(QC.sscd);
			qc.type = value.includes(QC.eseal) ? 'siegel' : value.includes(QC.esign) ? 'signatur' : value.includes(QC.web) ? 'web' : null;
		}
	} catch {
		/* ohne Erweiterung */
	}
	return {
		name: field(x.subject, 'CN') || field(x.subject, 'O') || x.subject,
		organization: field(x.subject, 'O'),
		subject: x.subject.replace(/\n/g, ', '),
		issuerName: field(x.issuer, 'CN') || field(x.issuer, 'O') || x.issuer,
		issuer: x.issuer.replace(/\n/g, ', '),
		serial: x.serialNumber,
		notBefore: new Date(x.validFrom).toISOString(),
		notAfter: new Date(x.validTo).toISOString(),
		fingerprint: x.fingerprint256.replace(/:/g, '').toLowerCase(),
		selfSigned,
		qc
	};
}

export function qualification(info: Pick<CertInfo, 'selfSigned' | 'qc'>): Qualification {
	if (info.selfSigned) return 'selbst';
	if (info.qc.compliance && info.qc.sscd) return 'qualifiziert';
	if (info.qc.compliance) return 'qualifiziertes-zertifikat';
	return 'ausgestellt';
}

/** War das Zertifikat zum Zeitpunkt gültig? */
export function validAt(info: Pick<CertInfo, 'notBefore' | 'notAfter'>, at: Date): boolean {
	return at >= new Date(info.notBefore) && at <= new Date(info.notAfter);
}
