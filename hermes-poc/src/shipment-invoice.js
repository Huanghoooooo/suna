const DEFAULT_INVOICE_SHEETS = ['德国', '英国', '法国', '意大利', '西班牙', '波兰', '德语发票', '贷记单'];

const COUNTRY_CODE_TO_INVOICE_COUNTRY = {
  DE: '德国',
  GB: '英国',
  UK: '英国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
};

const COUNTRY_CODE_TO_STORE_GROUP = {
  US: 'US-CA',
  DE: 'EU-DE',
  FR: 'EU-DE',
  IT: 'EU-DE',
  ES: 'EU-DE',
  GB: 'UK-LON',
  UK: 'UK-LON',
  JP: 'JP-TYO',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) {
    return todayIso();
  }
  return String(value).slice(0, 10);
}

function normalizeStaDetail(input) {
  if (!input) {
    throw new Error('STA detail is empty');
  }
  if (input.data) {
    return input.data;
  }
  if (input.response && input.response.data) {
    return input.response.data;
  }
  return input;
}

function firstItem(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : {};
}

function field(name, label, inputType = 'text', extra = {}) {
  return {
    name,
    label,
    inputType,
    required: true,
    ...extra,
  };
}

function requiredInvoiceFields(draft) {
  const required = [];
  if (!draft.store) {
    required.push(field('store', '发票模板店铺'));
  }
  if (!draft.sheet) {
    required.push(
      field('sheet', '发票模板页签', 'select', {
        options: draft.invoiceSheetOptions || DEFAULT_INVOICE_SHEETS,
        reason: draft.countryCode === 'US' ? '当前发票 skill 无美国专用页签，请选择可用模板页签' : '缺少可用发票模板页签',
      })
    );
  }
  if (!draft.customerInfo) {
    required.push(field('customerInfo', '客户/收票方信息', 'textarea'));
  }
  if (draft.unitPrice === undefined || draft.unitPrice === null || draft.unitPrice === '') {
    required.push(field('unitPrice', '单价', 'number'));
  }
  if (!draft.currency) {
    required.push(field('currency', '币种', 'select', { options: ['EUR', 'GBP', 'USD', 'CNY'] }));
  }
  if (!draft.productDescription) {
    required.push(field('productDescription', '商品描述', 'textarea'));
  }
  return required;
}

function mapStaDetailToInvoiceDraft(staDetailInput) {
  const detail = normalizeStaDetail(staDetailInput);
  const shipment = firstItem(detail.shipmentList);
  const product = firstItem(detail.productList);
  const address = detail.addressVO || {};
  const countryCode = String(address.countryCode || '').toUpperCase();
  const shipmentConfirmationId = shipment.shipmentConfirmationId || '';
  const invoiceCountry = COUNTRY_CODE_TO_INVOICE_COUNTRY[countryCode] || '';
  const productDescription =
    product.title || product.productName || product.name || product.msku || product.sku || '';
  const quantity = Number(product.quantity || 1);
  const invoiceNumber = shipmentConfirmationId
    ? `RO-${shipmentConfirmationId}`
    : `RO-${String(detail.inboundPlanId || 'STA').slice(0, 12)}`;

  const draft = {
    store: '',
    country: invoiceCountry,
    sheet: invoiceCountry,
    invoiceSheetOptions: DEFAULT_INVOICE_SHEETS,
    countryCode,
    orderNumber: shipmentConfirmationId || detail.inboundPlanId || '',
    invoiceNumber,
    invoiceDate: todayIso(),
    deliveryDate: dateOnly(detail.gmtModified || detail.planUpdateTime || detail.planCreateTime),
    customerInfo: '',
    productDescription,
    quantity,
    unitPrice: '',
    currency: '',
    storeGroup: COUNTRY_CODE_TO_STORE_GROUP[countryCode] || 'UNKNOWN',
    shipment: {
      inboundPlanId: detail.inboundPlanId,
      shipmentId: shipment.shipmentId || '',
      shipmentConfirmationId,
      shipmentStatus: shipment.status || '',
      planName: detail.planName || '',
      planStatus: detail.status || '',
      sid: detail.sid || null,
    },
    product: {
      msku: product.msku || '',
      fnsku: product.fnsku || '',
      asin: product.asin || '',
      quantity,
      title: productDescription,
    },
    address: {
      countryCode,
      city: address.city || '',
      stateOrProvinceCode: address.stateOrProvinceCode || '',
      postalCode: address.postalCode || '',
      shipperName: address.shipperName || '',
    },
  };

  return {
    detail,
    draft,
    requiredFields: requiredInvoiceFields(draft),
  };
}

function buildInvoiceConfirmation({ draft, requiredFields }) {
  const shipment = draft.shipment || {};
  const product = draft.product || {};
  const parameters = [
    { label: 'FBA号', value: shipment.shipmentConfirmationId || '-' },
    { label: 'STA任务', value: shipment.inboundPlanId || '-' },
    { label: '货件状态', value: shipment.shipmentStatus || shipment.planStatus || '-' },
    { label: '商品', value: product.msku || product.asin || '-' },
    { label: '数量', value: String(product.quantity || draft.quantity || 0) },
    { label: '目的国', value: draft.countryCode || '-' },
  ];

  if (requiredFields.length > 0) {
    parameters.push({
      label: '需补齐字段',
      value: requiredFields.map((item) => item.label).join('、'),
    });
  }

  return {
    title: `是否为 ${shipment.shipmentConfirmationId || shipment.inboundPlanId} 生成发票？`,
    riskLevel: requiredFields.length > 0 ? 'medium' : 'high',
    parameters,
    fields: requiredFields,
    type: 'shipment_invoice_followup',
  };
}

function mergeInvoiceFields(draft, fields = {}) {
  const merged = {
    ...draft,
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ])
    ),
  };

  if (merged.quantity !== undefined) {
    merged.quantity = Number(merged.quantity);
  }
  if (merged.unitPrice !== undefined && merged.unitPrice !== '') {
    merged.unitPrice = Number(merged.unitPrice);
  }

  const missing = requiredInvoiceFields(merged);
  if (missing.length > 0) {
    const error = new Error(`Missing invoice fields: ${missing.map((item) => item.label).join(', ')}`);
    error.statusCode = 400;
    error.missingFields = missing;
    throw error;
  }
  if (!merged.country && merged.sheet) {
    merged.country = merged.sheet;
  }
  if (!Number.isFinite(merged.quantity) || merged.quantity <= 0) {
    const error = new Error('Invoice quantity must be greater than 0');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(merged.unitPrice)) {
    const error = new Error('Invoice unit price is invalid');
    error.statusCode = 400;
    throw error;
  }

  return merged;
}

module.exports = {
  DEFAULT_INVOICE_SHEETS,
  buildInvoiceConfirmation,
  mapStaDetailToInvoiceDraft,
  mergeInvoiceFields,
  requiredInvoiceFields,
};
