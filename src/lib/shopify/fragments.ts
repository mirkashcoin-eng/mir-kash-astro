export const IMAGE_FRAGMENT = /* GraphQL */ `
  fragment ImageFields on Image {
    url
    altText
    width
    height
  }
`;

export const MONEY_FRAGMENT = /* GraphQL */ `
  fragment MoneyFields on MoneyV2 {
    amount
    currencyCode
  }
`;

export const PRODUCT_FRAGMENT = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    availableForSale
    vendor
    productType
    tags
    featuredImage { ...ImageFields }
    images(first: 3) {
      edges { node { ...ImageFields } }
    }
    variants(first: 25) {
      edges {
        node {
          id
          title
          availableForSale
          price { ...MoneyFields }
          compareAtPrice { ...MoneyFields }
          selectedOptions { name value }
          image { ...ImageFields }
        }
      }
    }
    priceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
    compareAtPriceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
  }
`;

export const COLLECTION_FRAGMENT = /* GraphQL */ `
  fragment CollectionFields on Collection {
    id
    handle
    title
    description
    image { ...ImageFields }
  }
`;

// Richer single-product fragment for the PDP: full image set, options, html body.
export const PRODUCT_PAGE_FRAGMENT = /* GraphQL */ `
  fragment ProductPageFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    vendor
    productType
    tags
    options { name values }
    featuredImage { ...ImageFields }
    images(first: 10) {
      edges { node { ...ImageFields } }
    }
    variants(first: 100) {
      edges {
        node {
          id
          title
          availableForSale
          price { ...MoneyFields }
          compareAtPrice { ...MoneyFields }
          selectedOptions { name value }
          image { ...ImageFields }
        }
      }
    }
    priceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
    compareAtPriceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
  }
`;

// Cart shape used by the cart page + API endpoints.
export const CART_FRAGMENT = /* GraphQL */ `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    discountCodes { applicable code }
    cost {
      subtotalAmount { ...MoneyFields }
      totalAmount { ...MoneyFields }
    }
    lines(first: 100) {
      edges {
        node {
          id
          quantity
          cost { totalAmount { ...MoneyFields } }
          merchandise {
            ... on ProductVariant {
              id
              title
              price { ...MoneyFields }
              image { ...ImageFields }
              product { title handle }
            }
          }
        }
      }
    }
  }
`;
