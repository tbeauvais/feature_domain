(function(){

  describe('sampleDomainApp', function () {
    var scope,
      controller,
      AppGenerate,
      AppFeatures;

    beforeEach(function () {
      module('sampleDomainApp');
    });

    describe('FeaturesCtrl', function () {

      beforeEach(inject(function ($rootScope, $controller) {
        scope = $rootScope.$new();

        // Mock out loading of data from AppFeatures.loadFeatures
        AppFeatures = {
          loadFeatures: function(){
            var success = function (process) {
              process({data: {}});
            };
            return { success: success }
          }
        };

        spyOn(scope.$root, '$broadcast');

        controller = $controller('FeaturesCtrl', {
          '$scope': scope,
          'AppFeatures': AppFeatures,
          'AppMetadata': AppMetadata
        });

      }));

      it('sets sortableOptions', function () {
        expect(scope.sortableOptions).not.toEqual(null);
      });

      it('broadcasts generateContent event', function () {
        expect(scope.$root.$broadcast).toHaveBeenCalledWith('generateContent', {data: {}});
      });

    });

  });

})();
