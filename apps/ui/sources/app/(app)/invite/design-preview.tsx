import * as React from 'react';
import { Redirect } from 'expo-router';

export default function ComboDesignPreviewRoute() {
    if (!__DEV__) return <Redirect href="/" />;
    // Keep fixtures behind the development-only branch, never an auth bypass.
    const Preview = require('@/dev/ComboDesignPreview').ComboDesignPreview;
    return <Preview />;
}
