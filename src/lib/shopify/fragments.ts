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
