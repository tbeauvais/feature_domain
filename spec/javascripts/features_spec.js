(function(){

  describe('factory: Features', function () {
    var features;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {

      inject(function ($injector) {
        features = $injector.get('Features');
      });

    });

    it('getFeature returns the correct feature', function () {
      expect(features.getFeature('TextFeature').name).toEqual('Text');
    });

    it('getFeatures returns all features', function () {
      expect(features.getFeatures()).not.toEqual(null);
    });

  });

})();
